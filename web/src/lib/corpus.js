// Loads the Phase 1 corpus straight from <repo>/data/laws at build time.
// Nothing is copied into web/: Vite inlines the JSON from its original location.

const modules = import.meta.glob('../../../data/laws/*.json', { eager: true, import: 'default' });

export function loadCorpus() {
  const docs = {};
  const units = [];
  let edges = [];
  let manifest = null;
  for (const [path, mod] of Object.entries(modules)) {
    const name = path.split('/').pop();
    if (name === 'manifest.json') manifest = mod;
    else if (name === 'references.json') edges = mod.edges;
    else {
      docs[mod.doc.doc_id] = mod.doc;
      units.push(...mod.units);
    }
  }
  return { docs, units, edges, manifest };
}
