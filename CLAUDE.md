# Basin Shaper — notes for Claude

Browser tool (Vite + TypeScript, no runtime dependencies) for designing rain gardens and retention basins from rough footprints and exporting GIS geometry for flood models. Owner: Joshua (MSc thesis, SLU; flood model PluvioFlow is also TypeScript).

## Commands
- `npm run dev`: dev server
- `npm test`: vitest (test/)
- `npm run typecheck`: strict tsc
- `npm run build`: single-file `dist/index.html` (vite-plugin-singlefile)

## Rules
- `src/engine/` must stay pure (no DOM, no browser APIs) so PluvioFlow can import it. Add a test in `test/` for any engine change.
- Coordinates are projected metres. Lon/lat input is reprojected on import.
- Shapefile conventions: outer rings clockwise, holes counter-clockwise, rings closed on write. DBF field names ≤ 10 chars.
- Depth is positive downwards from the rim; side slope `m` is horizontal : vertical (1 : m).
- No new runtime dependencies without asking; the built file must run offline.
- UI colours come from CSS tokens in `src/styles.css` (light + dark); canvas code reads them with `css('--token')`.
