.PHONY: pdf clean view

# Builds main.pdf via Tectonic (self-contained LaTeX engine).
# Install Tectonic: https://tectonic-typesetting.github.io/en-US/install.html
# Or use apt: sudo apt install texlive-latex-extra texlive-fonts-recommended

pdf: main.pdf

main.pdf: main.tex
	tectonic --keep-logs --keep-intermediates main.tex || pdflatex main.tex

clean:
	rm -f *.aux *.log *.out *.toc *.bbl *.blg *.fdb_latexmk *.fls *.synctex.gz main.pdf

view: main.pdf
	xdg-open main.pdf 2>/dev/null || open main.pdf 2>/dev/null || echo "Open main.pdf manually"
