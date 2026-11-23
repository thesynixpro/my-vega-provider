// Pornhub catalog.
//
// Pornhub renders its video grid client-side, so listings come from the public
// webmasters JSON API. Filter values are "ordering:<x>" / "category:<slug>"
// pairs; posts.ts turns them into the matching query parameters.

export const catalog = [
  { title: "Most Viewed", filter: "ordering:mostviewed" },
  { title: "Newest", filter: "ordering:newest" },
  { title: "Top Rated", filter: "ordering:rating" },
];

export const genres = [
  { title: "Amateur", filter: "category:amateur" },
  { title: "Anal", filter: "category:anal" },
  { title: "Big Tits", filter: "category:big-tits" },
  { title: "Teen (18+)", filter: "category:teen" },
  { title: "MILF", filter: "category:milf" },
  { title: "Japanese", filter: "category:japanese" },
  { title: "Lesbian", filter: "category:lesbian" },
  { title: "Ebony", filter: "category:ebony" },
];
