// Where the atlas loads its files from. Both default to the same origin (files deployed with the site).
// To host the heavy .glb files elsewhere (e.g. a public Supabase Storage bucket), point modelBase at it:
//   modelBase: "https://<project-ref>.supabase.co/storage/v1/object/public/anatomy/models/"
// The trailing slash matters. dataBase (manifest + descriptions, ~3 MB) can stay local.
window.ATLAS_CONFIG = {
  modelBase: "models/",
  dataBase: "data/",
  imgBase: "img/",
};
