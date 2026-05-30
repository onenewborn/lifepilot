const directionVideoManifest = [
  {
    directionId: "dir_hot_soup_noodles",
    url: "/assets/food-direction-videos/hot_soup_noodles.mobile.mp4",
    posterUrl: "/assets/food-directions/hot_soup_noodles.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_light_rice_noodles",
    url: "/assets/food-direction-videos/light_rice_noodles.mobile.mp4",
    posterUrl: "/assets/food-directions/light_rice_noodles.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_budget_rice_bowls",
    url: "/assets/food-direction-videos/budget_rice_bowls.mp4",
    posterUrl: "/assets/food-directions/budget_rice_bowls.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_pork_knuckle_rice",
    url: "/assets/food-direction-videos/pork_knuckle_rice.mp4",
    posterUrl: "/assets/food-directions/pork_knuckle_rice.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_malatang_light",
    url: "/assets/food-direction-videos/malatang_light.mobile.mp4",
    posterUrl: "/assets/food-directions/malatang_light.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_japanese_teishoku",
    url: "/assets/food-direction-videos/japanese_teishoku.mobile.mp4",
    posterUrl: "/assets/food-directions/japanese_teishoku.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_korean_bibimbap",
    url: "/assets/food-direction-videos/korean_bibimbap.mp4",
    posterUrl: "/assets/food-directions/korean_bibimbap.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_beef_hotpot_chaoshan",
    url: "/assets/food-direction-videos/beef_hotpot_chaoshan.mobile.mp4",
    posterUrl: "/assets/food-directions/beef_hotpot_chaoshan.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_sichuan_small_bistro",
    url: "/assets/food-direction-videos/sichuan_small_bistro.mobile.mp4",
    posterUrl: "/assets/food-directions/sichuan_small_bistro.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_roast_meat_rice",
    url: "/assets/food-direction-videos/roast_meat_rice.mobile.mp4",
    posterUrl: "/assets/food-directions/roast_meat_rice.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_light_salad",
    url: "/assets/food-direction-videos/light_salad.mp4",
    posterUrl: "/assets/food-directions/light_salad.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_tea_restaurant",
    url: "/assets/food-direction-videos/tea_restaurant.mobile.mp4",
    posterUrl: "/assets/food-directions/tea_restaurant.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_butter_hotpot",
    url: "/assets/food-direction-videos/butter_hotpot.mobile.mp4",
    posterUrl: "/assets/food-directions/butter_hotpot.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_hunan_stir_fry",
    url: "/assets/food-direction-videos/hunan_stir_fry.mp4",
    posterUrl: "/assets/food-directions/hunan_stir_fry.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_sushi_chat",
    url: "/assets/food-direction-videos/sushi_chat.mp4",
    posterUrl: "/assets/food-directions/sushi_chat.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  },
  {
    directionId: "dir_coconut_chicken",
    url: "/assets/food-direction-videos/coconut_chicken.mp4",
    posterUrl: "/assets/food-directions/coconut_chicken.jpg",
    hasSound: true,
    version: "2026-05-21-a"
  }
];

function videoByDirectionId() {
  return directionVideoManifest.reduce((lookup, item) => {
    lookup[item.directionId] = item;
    return lookup;
  }, {});
}

module.exports = {
  directionVideoManifest,
  videoByDirectionId
};
