import type { Region } from "./types";

/** Pass 1 finished 2026-11-09: 62 counties, 1,753 rows, $8.96. */
export const NEW_YORK: Region = {
  slug: "new-york",
  name: "New York",
  abbr: "NY",
  countyCount: 62,
  tiers: {
    large: {
      cap: 400,
      counties: ["New York", "Kings", "Queens", "Bronx", "Nassau", "Suffolk", "Westchester"],
    },
    mid: {
      cap: 150,
      counties: [
        "Richmond", "Erie", "Monroe", "Onondaga", "Albany", "Orange", "Rockland", "Dutchess",
        "Saratoga", "Ulster", "Oneida", "Broome", "Niagara", "Schenectady", "Rensselaer",
      ],
    },
    small: {
      cap: 60,
      counties: [
        "Allegany", "Cattaraugus", "Cayuga", "Chautauqua", "Chemung", "Chenango", "Clinton",
        "Columbia", "Cortland", "Delaware", "Essex", "Franklin", "Fulton", "Genesee", "Greene",
        "Hamilton", "Herkimer", "Jefferson", "Lewis", "Livingston", "Madison", "Montgomery",
        "Ontario", "Orleans", "Oswego", "Otsego", "Putnam", "St. Lawrence", "Schoharie",
        "Schuyler", "Seneca", "Steuben", "Sullivan", "Tioga", "Tompkins", "Warren", "Washington",
        "Wayne", "Wyoming", "Yates",
      ],
    },
  },
  batches: {
    1: [
      "New York", "Nassau", "Westchester",
      "Richmond", "Onondaga", "Rockland", "Ulster", "Niagara",
      "Allegany", "Cattaraugus", "Cayuga", "Chautauqua", "Chemung", "Chenango", "Clinton",
      "Columbia", "Cortland", "Delaware", "Essex", "Franklin", "Fulton",
    ],
    2: [
      "Kings", "Suffolk",
      "Erie", "Albany", "Dutchess", "Oneida", "Schenectady",
      "Genesee", "Greene", "Hamilton", "Herkimer", "Jefferson", "Lewis", "Livingston",
      "Madison", "Montgomery", "Ontario", "Orleans", "Oswego", "Otsego", "Putnam",
    ],
    3: [
      "Queens", "Bronx",
      "Monroe", "Orange", "Saratoga", "Broome", "Rensselaer",
      "St. Lawrence", "Schoharie", "Schuyler", "Seneca", "Steuben", "Sullivan", "Tioga",
      "Tompkins", "Warren", "Washington", "Wayne", "Wyoming", "Yates",
    ],
  },
};
