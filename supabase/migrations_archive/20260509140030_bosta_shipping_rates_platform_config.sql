-- Runtime Bosta courier rates (EGP, all-in locked formula per governorate slug).
-- App merges these overrides with code fallbacks in `src/lib/bostaShipping.ts`.
INSERT INTO platform_config (key, value) VALUES (
  'bosta_shipping_rates',
  '{"cairo":115,"giza":115,"sixth_october":115,"6th_october":115,"sheikh_zayed":115,"new_cairo":115,"heliopolis":115,"nasr_city":115,"maadi":115,"zamalek":115,"downtown":115,"shubra":115,"ain_shams":115,"alexandria":120,"alex":120,"mansoura":130,"tanta":130,"zagazig":130,"ismailia":130,"port_said":130,"suez":130,"damietta":130,"kafr_el_sheikh":130,"gharbia":130,"sharqia":130,"dakahlia":130,"beheira":130,"monufia":130,"qalyubia":130,"aswan":165,"luxor":165,"assiut":165,"asyut":165,"sohag":165,"qena":165,"hurghada":165,"red_sea":165,"minya":165,"beni_suef":165,"fayoum":165,"faiyum":165,"south_sinai":165,"north_sinai":165,"matrouh":165,"new_valley":165,"other_upper_egypt":165}'::jsonb
) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
