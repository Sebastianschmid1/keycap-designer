// Zuordnung Taste -> Filament-Slots (1-basiert = Bambu-Extruder) aus einer JSON-Beschreibung:
// {"default": {"cap": 1, "legend": 2}, "kind": {"mod": {"cap": 3}}, "keys": {"Escape": {"cap": 4}}}
// Vorrang: default < kind < keys; fehlende Felder behalten den Wert der niedrigeren Stufe.
export function resolveAssign(spec, key) {
  const out = { cap: 1, legend: 2, ...(spec.default || {}) };
  Object.assign(out, (spec.kind || {})[key.kind] || {}, (spec.keys || {})[key.id] || {});
  return out;
}
