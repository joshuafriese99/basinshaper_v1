/** Supported output coordinate systems with ESRI WKT for .prj files. */

const GCS = {
  etrs: 'GEOGCS["GCS_ETRS_1989",DATUM["D_ETRS_1989",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  swe: 'GEOGCS["GCS_SWEREF99",DATUM["D_SWEREF99",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
};

const tm = (name: string, g: string, lon0: number) =>
  `PROJCS["${name}",${g},PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",${lon0.toFixed(1)}],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;

export interface CrsDef {
  id: string;
  label: string;
  /** central meridian for lon/lat reprojection; null = no reprojection possible */
  lon0: number | null;
  wkt: string | null;
}

export const CRS_LIST: CrsDef[] = [
  { id: 'EPSG:25832', label: 'ETRS89 / UTM 32N (EPSG:25832) – Denmark, W Germany', lon0: 9, wkt: tm('ETRS_1989_UTM_Zone_32N', GCS.etrs, 9) },
  { id: 'EPSG:25833', label: 'ETRS89 / UTM 33N (EPSG:25833) – E Germany', lon0: 15, wkt: tm('ETRS_1989_UTM_Zone_33N', GCS.etrs, 15) },
  { id: 'EPSG:3006', label: 'SWEREF99 TM (EPSG:3006) – Sweden', lon0: 15, wkt: tm('SWEREF99_TM', GCS.swe, 15) },
  { id: 'src', label: 'Same as imported file (.prj)', lon0: null, wkt: null },
];

/** PROJCS name from a WKT string, if any. */
export function projcsName(wkt: string): string | null {
  return wkt.match(/PROJCS\["([^"]+)"/)?.[1] ?? null;
}
