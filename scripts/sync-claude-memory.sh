#!/bin/bash
# Sanitized for publication — see .env.example for required variables
# Original: runs on Machine-A (Machine-A) via cron every 15 minutes
# Syncs claude-mem databases and memory files across a 3-machine fleet
# Sync Claude Code: Machine-A → bot host (Machine-C), prod host (Machine-B), win host (Windows, quando na LAN)
# Memory files (bidirecional) + claude-mem DB (push) + settings (push)
# Roda via cron na Machine-A a cada 15 min

export PATH="$HOME/.bun/bin:$HOME/.local/bin:$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"

# Fleet config (hosts, ntfy, SSH)
FLEET_ENV="$HOME/.claude-mem/.env-fleet"
[ -f "$FLEET_ENV" ] && source "$FLEET_ENV"

SSH_KEY="${FLEET_SSH_KEY:?Set FLEET_SSH_KEY}"
SSH_CMD="ssh -i $SSH_KEY -o ConnectTimeout=5"
LOCAL_MEM="$HOME/.claude/projects/{USER_PROJECT}/memory/"
REMOTE_MEM=".claude/projects/{USER_PROJECT}/memory/"
LOCAL_DB="$HOME/.claude-mem/claude-mem.db"
LOCAL_SETTINGS="$HOME/.claude-mem/settings.json"
TEMP_DIR="/tmp/claude-mem-sync"

REMOTES=(
  "${FLEET_USER:?Set FLEET_USER}@${FLEET_BOT_HOST:?Set FLEET_BOT_HOST}"
  "${FLEET_USER:?Set FLEET_USER}@${FLEET_PROD_HOST:?Set FLEET_PROD_HOST}"
  "${FLEET_WIN_USER:?Set FLEET_WIN_USER}@${FLEET_WIN_HOST:?Set FLEET_WIN_HOST}"
)
LABELS=("${FLEET_BOT_HOST} (Machine-C)" "${FLEET_PROD_HOST} (Machine-B)" "${FLEET_WIN_HOST} (Windows)")

sync_remote() {
  local remote="$1"
  local label="$2"

  # Verificar conectividade com retry 3x (filtra glitches transitórios de SSH/rede
  # observados especialmente em bot host/Machine-C — 2026-04-10 ajuste após gap de 2.5h)
  local attempt
  local connected=false
  for attempt in 1 2 3; do
    if $SSH_CMD "$remote" "echo ok" >/dev/null 2>&1; then
      connected=true
      break
    fi
    [ "$attempt" -lt 3 ] && sleep 3
  done
  if [ "$connected" = false ]; then
    echo "[$(date '+%Y-%m-%d %H:%M')] $label offline after 3 attempts, skip"
    return
  fi

  # Detect Windows (user aless = Windows)
  local is_windows=false
  case "$remote" in *"${FLEET_WIN_USER}"@*) is_windows=true ;; esac

  if [ "$is_windows" = true ]; then
    sync_windows "$remote" "$label"
  else
    sync_linux "$remote" "$label"
  fi
}

sync_linux() {
  local remote="$1"
  local label="$2"

  # === 1. Memory files (bidirecional, timestamp wins) ===
  local temp="$TEMP_DIR/$label"
  mkdir -p "$temp"
  rsync -az -e "$SSH_CMD" "$remote:$REMOTE_MEM" "$temp/" 2>/dev/null

  for f in "$temp"/*; do
    [ -f "$f" ] || continue
    fname=$(basename "$f")
    local_f="$LOCAL_MEM/$fname"
    if [ -f "$local_f" ]; then
      [ "$f" -nt "$local_f" ] && cp "$f" "$local_f"
    else
      cp "$f" "$local_f"
    fi
  done

  rsync -az -e "$SSH_CMD" "$LOCAL_MEM" "$remote:$REMOTE_MEM"

  # === 2. claude-mem DB (merge remote → local, then push) ===
  if [ -f "$LOCAL_DB" ]; then
    local remote_db="/tmp/claude-mem-remote-${label// /_}.db"
    $SSH_CMD "$remote" 'python3 -c "import sqlite3,os; sqlite3.connect(os.path.expanduser(\"~/.claude-mem/claude-mem.db\")).execute(\"PRAGMA wal_checkpoint(TRUNCATE)\")"' 2>/dev/null
    $SSH_CMD "$remote" "cat ~/.claude-mem/claude-mem.db" > "$remote_db" 2>/dev/null
    if [ -s "$remote_db" ]; then
      cd "$HOME/claude-mem-contrib" 2>/dev/null
      local merged
      merged=$(bun -e "
const local = require('bun:sqlite').Database.open('$LOCAL_DB');
const remote = require('bun:sqlite').Database.open('$remote_db', {readonly: true});
const localHashes = new Set(local.query('SELECT content_hash FROM observations WHERE content_hash IS NOT NULL').all().map(r => r.content_hash));
const remoteObs = remote.query('SELECT * FROM observations WHERE content_hash IS NOT NULL').all();
let imported = 0;
const insert = local.prepare('INSERT OR IGNORE INTO observations (memory_session_id, project, text, type, title, subtitle, facts, narrative, concepts, files_read, files_modified, prompt_number, discovery_tokens, created_at, created_at_epoch, content_hash, status, relevance_count, generated_by_model) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
for (const o of remoteObs) {
  if (!localHashes.has(o.content_hash)) {
    insert.run(o.memory_session_id, o.project, o.text, o.type, o.title, o.subtitle, o.facts, o.narrative, o.concepts, o.files_read, o.files_modified, o.prompt_number, o.discovery_tokens, o.created_at, o.created_at_epoch, o.content_hash, o.status, o.relevance_count || 0, o.generated_by_model);
    imported++;
  }
}
remote.close();
console.log(imported);
" 2>/dev/null)
      [ -n "$merged" ] && [ "$merged" -gt 0 ] && echo "[$(date '+%Y-%m-%d %H:%M')] Merged $merged new observations from $label"
    fi
    # Push DB if: (a) new obs merged from remote, or (b) local has more obs than remote
    local needs_push=false
    [ -n "$merged" ] && [ "$merged" -gt 0 ] && needs_push=true
    if [ "$needs_push" = false ] && [ -s "$remote_db" ]; then
      local local_count remote_count
      local_count=$(bun -e "console.log(require('bun:sqlite').Database.open('$LOCAL_DB',{readonly:true}).query('SELECT COUNT(*) as c FROM observations').get().c)" 2>/dev/null)
      remote_count=$(bun -e "console.log(require('bun:sqlite').Database.open('$remote_db',{readonly:true}).query('SELECT COUNT(*) as c FROM observations').get().c)" 2>/dev/null)
      [ -n "$local_count" ] && [ -n "$remote_count" ] && [ "$local_count" -gt "$remote_count" ] && needs_push=true
    fi
    rm -f "$remote_db"

    if [ "$needs_push" = true ]; then
      # Checkpoint local WAL before push (DB + WAL must be atomic)
      cd "$HOME/claude-mem-contrib" 2>/dev/null
      bun -e "require('bun:sqlite').Database.open('$LOCAL_DB').run('PRAGMA wal_checkpoint(TRUNCATE)')" 2>/dev/null
      # Stop remote worker, clean WAL, push clean DB, restart
      $SSH_CMD "$remote" "systemctl --user stop claude-mem-worker; rm -f ~/.claude-mem/worker.pid ~/.claude-mem/claude-mem.db-shm ~/.claude-mem/claude-mem.db-wal" 2>/dev/null
      rsync -az -e "$SSH_CMD" "$LOCAL_DB" "$remote:.claude-mem/claude-mem.db"
      $SSH_CMD "$remote" "systemctl --user start claude-mem-worker" 2>/dev/null
      echo "[$(date '+%Y-%m-%d %H:%M')] DB pushed to $label (merged $merged obs)"
    fi
  fi

  # === 3. Settings sync (Machine-A é fonte de verdade, preserva CHROMA_ENABLED do remote) ===
  if [ -f "$LOCAL_SETTINGS" ]; then
    local remote_chroma
    remote_chroma=$($SSH_CMD "$remote" 'grep CHROMA_ENABLED ~/.claude-mem/settings.json 2>/dev/null | grep -o "true\|false"' 2>/dev/null)
    rsync -az -e "$SSH_CMD" "$LOCAL_SETTINGS" "$remote:.claude-mem/settings.json"
    if [ -n "$remote_chroma" ]; then
      $SSH_CMD "$remote" "sed -i 's/\"CLAUDE_MEM_CHROMA_ENABLED\": \"[^\"]*\"/\"CLAUDE_MEM_CHROMA_ENABLED\": \"$remote_chroma\"/' ~/.claude-mem/settings.json" 2>/dev/null
    fi
  fi
  # Only sync CLAUDE.md (not settings.json — each machine has its own plugin config)
  rsync -az -e "$SSH_CMD" "$HOME/.claude/CLAUDE.md" "$remote:.claude/CLAUDE.md" 2>/dev/null

  # === 4. Plugin bundles (plugin/scripts/*.cjs + plugin/.claude-plugin/* + hooks/) ===
  # Machine-A é DEV host — seu marketplace dir recebe rebuilds via sync-marketplace.cjs
  # quando editamos ~/claude-mem-contrib. Este rsync replica os bundles pras
  # remotas automaticamente, eliminando scp manual dos .cjs após cada fix
  # (padrão estabelecido em 2026-04-10 pro fix dominantType + migration 30).
  local LOCAL_PLUGIN="$HOME/.claude/plugins/marketplaces/thedotmack/plugin/"
  if [ -d "$LOCAL_PLUGIN" ]; then
    # rsync --itemize-changes: only restart worker if files actually changed
    local changes
    changes=$(rsync -az --itemize-changes -e "$SSH_CMD" \
      --exclude='node_modules' \
      --exclude='package-lock.json' \
      --exclude='bun.lock' \
      --exclude='*.log' \
      "$LOCAL_PLUGIN" "$remote:.claude/plugins/marketplaces/thedotmack/plugin/" 2>/dev/null | grep -c '^>f')
    if [ "${changes:-0}" -gt 0 ]; then
      $SSH_CMD "$remote" "curl -sf -X POST --max-time 3 http://localhost:37777/api/admin/restart >/dev/null 2>&1 || true" 2>/dev/null
      echo "[$(date '+%Y-%m-%d %H:%M')] Plugin bundles updated on $label ($changes files), worker restarted"
    fi
  fi

  echo "[$(date '+%Y-%m-%d %H:%M')] Claude sync OK (Machine-A → $label)"
}

sync_windows() {
  local remote="$1"
  local label="$2"

  # Windows: scp-only (no rsync). Merge new obs from win host → Machine-A, then push DB + settings
  # === 1. Pull remote DB, merge new observations into local ===
  local remote_db="/tmp/claude-mem-win-remote.db"
  scp -i "$SSH_KEY" -o ConnectTimeout=5 "$remote:.claude-mem/claude-mem.db" "$remote_db" 2>/dev/null
  if [ -f "$remote_db" ] && [ -f "$LOCAL_DB" ]; then
    cd "$HOME/claude-mem-contrib" 2>/dev/null
    local merged
    merged=$(bun -e "
const local = require('bun:sqlite').Database.open('$LOCAL_DB');
const remote = require('bun:sqlite').Database.open('$remote_db', {readonly: true});
const localHashes = new Set(local.query('SELECT content_hash FROM observations WHERE content_hash IS NOT NULL').all().map(r => r.content_hash));
const remoteObs = remote.query('SELECT * FROM observations WHERE content_hash IS NOT NULL').all();
let imported = 0;
const insert = local.prepare('INSERT OR IGNORE INTO observations (memory_session_id, project, text, type, title, subtitle, facts, narrative, concepts, files_read, files_modified, prompt_number, discovery_tokens, created_at, created_at_epoch, content_hash, status, relevance_count, generated_by_model) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
for (const o of remoteObs) {
  if (!localHashes.has(o.content_hash)) {
    insert.run(o.memory_session_id, o.project, o.text, o.type, o.title, o.subtitle, o.facts, o.narrative, o.concepts, o.files_read, o.files_modified, o.prompt_number, o.discovery_tokens, o.created_at, o.created_at_epoch, o.content_hash, o.status, o.relevance_count || 0, o.generated_by_model);
    imported++;
  }
}
remote.close();
console.log(imported);
" 2>/dev/null)
    [ -n "$merged" ] && [ "$merged" -gt 0 ] && echo "[$(date '+%Y-%m-%d %H:%M')] Merged $merged new observations from $label"
    rm -f "$remote_db"
  fi

  # === 2. Push merged DB to remote (checkpoint WAL, kill bun, clean WAL, push) ===
  if [ -f "$LOCAL_DB" ]; then
    cd "$HOME/claude-mem-contrib" 2>/dev/null
    bun -e "require('bun:sqlite').Database.open('$LOCAL_DB').run('PRAGMA wal_checkpoint(TRUNCATE)')" 2>/dev/null
    $SSH_CMD "$remote" 'taskkill /IM bun.exe /F >nul 2>&1 & del "%USERPROFILE%\.claude-mem\claude-mem.db-shm" >nul 2>&1 & del "%USERPROFILE%\.claude-mem\claude-mem.db-wal" >nul 2>&1' 2>/dev/null
    scp -i "$SSH_KEY" -o ConnectTimeout=5 "$LOCAL_DB" "$remote:.claude-mem/claude-mem.db" 2>/dev/null
  fi

  # Settings: build Windows-specific version locally, then scp
  if [ -f "$LOCAL_SETTINGS" ]; then
    local win_settings="/tmp/claude-mem-win-settings.json"
    python3 -c "
import json,sys
with open('$LOCAL_SETTINGS') as f: s = json.load(f)
s['CLAUDE_MEM_CHROMA_ENABLED'] = 'false'
s['CLAUDE_MEM_WORKER_PORT'] = '38888'
s['CLAUDE_MEM_WORKER_HOST'] = '127.0.0.1'
s['CLAUDE_MEM_DATA_DIR'] = 'C:\\\\Users\\\\${FLEET_WIN_USER}\\\\.claude-mem'
json.dump(s, open('$win_settings','w'), indent=2)
" 2>/dev/null
    scp -i "$SSH_KEY" -o ConnectTimeout=5 "$win_settings" "$remote:.claude-mem/settings.json" 2>/dev/null
    rm -f "$win_settings"
  fi

  # === Plugin bundles (.cjs + plugin.json) — Windows scp ===
  # scp não suporta rsync --exclude, então copiamos só os arquivos essenciais.
  # Os bundles rebuilt em Machine-A via sync-marketplace.cjs ficam em
  # ~/.claude/plugins/marketplaces/thedotmack/plugin/scripts/*.cjs — replicados
  # aqui pro diretório equivalente no Windows.
  local LOCAL_PLUGIN_SCRIPTS="$HOME/.claude/plugins/marketplaces/thedotmack/plugin/scripts"
  local LOCAL_PLUGIN_MANIFEST="$HOME/.claude/plugins/marketplaces/thedotmack/plugin/.claude-plugin"
  if [ -d "$LOCAL_PLUGIN_SCRIPTS" ]; then
    for cjs in worker-service.cjs mcp-server.cjs context-generator.cjs worker-wrapper.cjs; do
      [ -f "$LOCAL_PLUGIN_SCRIPTS/$cjs" ] && \
        scp -i "$SSH_KEY" -o ConnectTimeout=5 "$LOCAL_PLUGIN_SCRIPTS/$cjs" \
          "$remote:.claude/plugins/marketplaces/thedotmack/plugin/scripts/$cjs" 2>/dev/null
    done
    [ -f "$LOCAL_PLUGIN_MANIFEST/plugin.json" ] && \
      scp -i "$SSH_KEY" -o ConnectTimeout=5 "$LOCAL_PLUGIN_MANIFEST/plugin.json" \
        "$remote:.claude/plugins/marketplaces/thedotmack/plugin/.claude-plugin/plugin.json" 2>/dev/null
    # Worker restart: Windows daemon vai ser auto-respawned pelo SessionStart hook
    # na próxima sessão Claude Code. Não há systemctl graceful restart aqui.
  fi

  echo "[$(date '+%Y-%m-%d %H:%M')] Claude sync OK (Machine-A → $label)"
}

SYNC_LOCK="/tmp/claude-mem-sync.lock"
touch "$SYNC_LOCK"
trap 'rm -f "$SYNC_LOCK"' EXIT

mkdir -p "$TEMP_DIR"

for i in "${!REMOTES[@]}"; do
  sync_remote "${REMOTES[$i]}" "${LABELS[$i]}"
done

rm -rf "$TEMP_DIR"
