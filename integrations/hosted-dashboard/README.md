# Hosted dashboard compatibility

The patch updates the existing DIP hosted dashboard to read and write the single `dip/state` branch while keeping the selected code branch as provenance. Apply it from that dashboard source checkout with `git apply compatibility.patch`, or use the already-updated source. It retains v1 fallback only for a genuine 404 and never force-updates a branch. Run the Node regression tests and TypeScript check before publishing.

`metadata.mjs` is also included separately for other GitHub consumers. Snapshot manifests remain content-addressed artifacts; a web projection treats verification as historical rather than proving the selected source.
