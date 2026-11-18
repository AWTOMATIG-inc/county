import type { Region } from "./types";

/**
 * Caps agreed 2026-11-10, sized to Arkansas (3.0M people, about 1/6 of New York):
 *   large 200 → charge limit $1.25, mid 100 → $0.63, small 60 → $0.50 (the actor's minimum,
 *   so a lower small cap would save nothing). Pulaski is about Erie County, NY's size,
 *   which returned 126 results. A county that reaches its cap gets the re-run button.
 * Batches: one large county each, mids round-robin by population, smalls alphabetical.
 */
export const ARKANSAS: Region = {
  slug: "arkansas",
  name: "Arkansas",
  abbr: "AR",
  countyCount: 75,
  tiers: {
    large: {
      cap: 200,
      counties: ["Pulaski", "Benton", "Washington"],
    },
    mid: {
      cap: 100,
      // 2020 census, largest first.
      counties: [
        "Sebastian", "Faulkner", "Saline", "Craighead", "Garland", "White", "Lonoke",
        "Jefferson", "Pope", "Crawford", "Crittenden",
      ],
    },
    small: {
      cap: 60,
      counties: [
        "Arkansas", "Ashley", "Baxter", "Boone", "Bradley", "Calhoun", "Carroll", "Chicot",
        "Clark", "Clay", "Cleburne", "Cleveland", "Columbia", "Conway", "Cross", "Dallas",
        "Desha", "Drew", "Franklin", "Fulton", "Grant", "Greene", "Hempstead", "Hot Spring",
        "Howard", "Independence", "Izard", "Jackson", "Johnson", "Lafayette", "Lawrence", "Lee",
        "Lincoln", "Little River", "Logan", "Madison", "Marion", "Miller", "Mississippi",
        "Monroe", "Montgomery", "Nevada", "Newton", "Ouachita", "Perry", "Phillips", "Pike",
        "Poinsett", "Polk", "Prairie", "Randolph", "St. Francis", "Scott", "Searcy", "Sevier",
        "Sharp", "Stone", "Union", "Van Buren", "Woodruff", "Yell",
      ],
    },
  },
  batches: {
    1: [
      "Pulaski",
      "Sebastian", "Craighead", "Lonoke", "Crawford",
      "Arkansas", "Ashley", "Baxter", "Boone", "Bradley", "Calhoun", "Carroll", "Chicot",
      "Clark", "Clay", "Cleburne", "Cleveland", "Columbia", "Conway", "Cross", "Dallas",
      "Desha", "Drew", "Franklin", "Fulton",
    ],
    2: [
      "Benton",
      "Faulkner", "Garland", "Jefferson", "Crittenden",
      "Grant", "Greene", "Hempstead", "Hot Spring", "Howard", "Independence", "Izard",
      "Jackson", "Johnson", "Lafayette", "Lawrence", "Lee", "Lincoln", "Little River", "Logan",
      "Madison", "Marion", "Miller", "Mississippi", "Monroe",
    ],
    3: [
      "Washington",
      "Saline", "White", "Pope",
      "Montgomery", "Nevada", "Newton", "Ouachita", "Perry", "Phillips", "Pike", "Poinsett",
      "Polk", "Prairie", "Randolph", "St. Francis", "Scott", "Searcy", "Sevier", "Sharp",
      "Stone", "Union", "Van Buren", "Woodruff", "Yell",
    ],
  },
};
