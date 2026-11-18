import type { Region } from "./types";

/**
 * Drafted 2026-11-18, sized like New York (Florida 21.5M people vs NY 20.2M, 2020 census):
 *   large 400 (over 900k people), mid 150 (150k to 900k), small 60.
 *   Charge limits: $2.50 / $0.94 / $0.50.
 * Batches: large round-robin by population (3/2/2), mids round-robin by population (9/9/8),
 * smalls alphabetical (11/11/12), for 23/22/22 counties.
 */
export const FLORIDA: Region = {
  slug: "florida",
  name: "Florida",
  abbr: "FL",
  countyCount: 67,
  tiers: {
    large: {
      cap: 400,
      counties: ["Miami-Dade", "Broward", "Palm Beach", "Hillsborough", "Orange", "Duval", "Pinellas"],
    },
    mid: {
      cap: 150,
      // 2020 census, largest first.
      counties: [
        "Lee", "Polk", "Brevard", "Pasco", "Volusia", "Seminole", "Sarasota", "Manatee",
        "Osceola", "Lake", "Marion", "Collier", "St. Lucie", "Escambia", "Leon", "Alachua",
        "St. Johns", "Clay", "Okaloosa", "Hernando", "Santa Rosa", "Charlotte", "Bay",
        "Indian River", "Martin", "Citrus",
      ],
    },
    small: {
      cap: 60,
      counties: [
        "Baker", "Bradford", "Calhoun", "Columbia", "DeSoto", "Dixie", "Flagler", "Franklin",
        "Gadsden", "Gilchrist", "Glades", "Gulf", "Hamilton", "Hardee", "Hendry", "Highlands",
        "Holmes", "Jackson", "Jefferson", "Lafayette", "Levy", "Liberty", "Madison", "Monroe",
        "Nassau", "Okeechobee", "Putnam", "Sumter", "Suwannee", "Taylor", "Union", "Wakulla",
        "Walton", "Washington",
      ],
    },
  },
  batches: {
    1: [
      "Miami-Dade", "Hillsborough", "Pinellas",
      "Lee", "Pasco", "Sarasota", "Lake", "St. Lucie", "Alachua", "Okaloosa", "Charlotte", "Martin",
      "Baker", "Bradford", "Calhoun", "Columbia", "DeSoto", "Dixie", "Flagler", "Franklin",
      "Gadsden", "Gilchrist", "Glades",
    ],
    2: [
      "Broward", "Orange",
      "Polk", "Volusia", "Manatee", "Marion", "Escambia", "St. Johns", "Hernando", "Bay", "Citrus",
      "Gulf", "Hamilton", "Hardee", "Hendry", "Highlands", "Holmes", "Jackson", "Jefferson",
      "Lafayette", "Levy", "Liberty",
    ],
    3: [
      "Palm Beach", "Duval",
      "Brevard", "Seminole", "Osceola", "Collier", "Leon", "Clay", "Santa Rosa", "Indian River",
      "Madison", "Monroe", "Nassau", "Okeechobee", "Putnam", "Sumter", "Suwannee", "Taylor",
      "Union", "Wakulla", "Walton", "Washington",
    ],
  },
};
