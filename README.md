# Sudoku

A calm, low-friction Sudoku for the browser. Puzzles are generated on the fly
and graded by the techniques they need. Hints teach you instead of just
filling in cells, and your game is always saved.

Static site in `public/`, deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`.

```sh
npm start   # serve public/ on http://localhost:8000
npm test    # engine tests (Node 20+)
```

See [docs/PRODUCT.md](docs/PRODUCT.md) for the feature and UX notes.
