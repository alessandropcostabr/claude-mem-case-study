# paper/

LaTeX source for the arXiv-ready version of the case study.

## Build

The preferred engine is [Tectonic](https://tectonic-typesetting.github.io/), a
self-contained LaTeX system that auto-fetches packages:

```bash
make pdf
```

If `tectonic` is not on `$PATH`, the Makefile falls back to `pdflatex`. To
install Tectonic without `sudo`:

```bash
curl -sL https://github.com/tectonic-typesetting/tectonic/releases/latest/download/tectonic-latest-x86_64-unknown-linux-musl.tar.gz | tar xz -C ~/.local/bin
```

For a system install of TeX Live (Debian/Ubuntu):

```bash
sudo apt install texlive-latex-extra texlive-fonts-recommended
```

## Submit to arXiv

arXiv expects either a single PDF (allowed) or the LaTeX source as a `.tar.gz`
that includes:

- `main.tex`
- `figures/` (the same files used at the repository root)
- Bibliography is inline in `main.tex` via `thebibliography` — no `.bib` file
  is required.

Build the bundle:

```bash
cd paper && tectonic main.tex
cd .. && tar czf arxiv-bundle.tar.gz paper/main.tex figures/*.png
```

Then upload `arxiv-bundle.tar.gz` at <https://arxiv.org/submit/>.
