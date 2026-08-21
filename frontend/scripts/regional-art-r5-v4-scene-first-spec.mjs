/** Production literals for the bounded R5 V4 scene-first reauthor. */

export const REGIONAL_R5_V4_AUTHORITY_SHA256 =
  "024bdae90a5f49aa10f49e760f29072112a1d38446d0cd831f58ba1aad9e81fa";

export const REGIONAL_R5_V4_KITS = Object.freeze([
  "ash-waste",
  "dry-scrub",
  "neutral-temperate",
  "spring-terraces",
  "worn-heartland",
]);

export const REGIONAL_R5_V4_REPAIR_INVENTORY = Object.freeze({
  "ash-waste": Object.freeze({
    landmarks: Object.freeze([[2,"containment-pylon"],[3,"leaning-containment-pylon"],[6,"directional-debris"],[7,"joined-containment-debris"]]),
    supports: Object.freeze([[1,"snapped-insulator"],[0,"cable-scrap"],[3,"coral-fissure"],[22,"fissure-return"],[65,"pylon-slag-return"],[69,"pylon-cable-return"],[96,"debris-char-return"],[100,"debris-filter-return"],[7,"sealed-filter-box"],[8,"collapsed-conduit"]]),
  }),
  "dry-scrub": Object.freeze({
    landmarks: Object.freeze([[0,"sandstone-west"],[1,"yard-windbreak-return"],[2,"track-bend-outcrop"],[3,"thorn-opening"],[4,"thorn-east-opening"],[5,"horizontal-scrub"],[6,"one-direction-scrub"],[7,"falling-scrub"]]),
    supports: Object.freeze([[0,"sandstone-chip"],[4,"pebble-fan"],[9,"deadwood-root"],[11,"thorn-return"],[2,"wind-scrub"],[6,"sand-ripple"],[8,"windbreak-stone"],[5,"shade-post"],[16,"ridge-stone-return"],[20,"ridge-pebble-return"],[65,"deadwood-return"],[69,"scrub-return"],[82,"wind-grass-return"],[86,"sand-ripple-return"],[98,"south-grass-return"],[102,"south-stone-return"]]),
  }),
  "neutral-temperate": Object.freeze({
    landmarks: Object.freeze([[1,"paired-grove"]]),
    supports: Object.freeze([[16,"grove-tree-return"],[20,"grove-understory-return"]]),
  }),
  "spring-terraces": Object.freeze({
    landmarks: Object.freeze([[2,"wet-stone-risers"],[5,"bank-willow-return"],[6,"wet-dry-north-south"],[7,"wet-dry-crossing"]]),
    supports: Object.freeze([[64,"wet-slab"],[68,"stone-riser"],[69,"root-return"],[73,"reed-return"],[70,"bank-junction"],[74,"stone-return"],[71,"west-abutment"],[75,"east-abutment"]]),
  }),
  "worn-heartland": Object.freeze({
    landmarks: Object.freeze([[3,"garden-route-gate"],[4,"garden-east-return"],[5,"reclaimed-diagonal"],[6,"eroded-route-band"],[7,"trampled-north-south"]]),
    supports: Object.freeze([[3,"broken-fence-return"],[2,"faded-flower"],[19,"garden-fence-return"],[23,"garden-flower-return"],[83,"boundary-post-return"],[87,"boundary-stone-return"],[1,"rut-stone"],[6,"eroded-tuft"],[85,"route-stone-return"],[89,"route-flower-return"],[5,"field-stone"]]),
  }),
});

export const REGIONAL_R5_V4_DYNAMIC_PLACEMENTS = Object.freeze({
  "ash-waste": Object.freeze([[288,352],[[88,421],[343,260],[400,431]]]),
  "dry-scrub": Object.freeze([[560,352],[[688,48],[480,168],[672,431]]]),
  "neutral-temperate": Object.freeze([[480,352],[[169,140],[64,224],[592,431]]]),
  "spring-terraces": Object.freeze([[512,352],[[24,136],[336,196],[624,431]]]),
  "worn-heartland": Object.freeze([[504,352],[[0,96],[80,224],[616,431]]]),
});

export const REGIONAL_R5_V4_PREDECESSOR_MASTER_SHA256 = Object.freeze({
  "ash-waste-home-yards":"434ac4f67869661e3b2b93afc92c4181fb515a2dc23657425579a63a09cb9102","ash-waste-landmarks":"b53c379927e7ae2a49ad2302db98a6caca10de009ceb71fae8ce510422d1abea","ash-waste-scenery":"9c9da56ef160b91522a851941a61ae6cca037cdec189e9c07d0cd0bf798ffb6f","ash-waste-terrain":"a89d5f52c896ce5aab2e036f0ee7e109b6020222f7d2ae9d18f72c47a29407f1",
  "dry-scrub-home-yards":"5663ea6f8292fb4d17ddc556246570d2ab18f6ad41b0e5381f59bcc5432ab460","dry-scrub-landmarks":"ed8d75cbc64d90413d8228ac13efd4fc2211f6a73a70f2b63f4effc4cd135d0e","dry-scrub-scenery":"5cfc442fc39e668281a9889cc591681a9b1ff2dddab5b64b9b0a502d6a898c92","dry-scrub-terrain":"e52ca60c85ae04ce3ea5d6ade2b0601cd33c8e83580ac60cc1ed49c005031af9",
  "neutral-temperate-home-yards":"13e17622f3375d1242c8d9881ccd4205f78ec6df55464f0df615ae3a4f8242c2","neutral-temperate-landmarks":"768332e554ac37af9f4069c35865c165fc1568912d25a1fae93297295a7dc1a2","neutral-temperate-scenery":"e6d8fb85b951f0a22e4817482d0b95b279fcdd9e9612ad84cd561f0fb8af0b40","neutral-temperate-terrain":"94e1c955959376363d6f4ad1757bae3ab0f08765b3816f8072d4e2722af23f12",
  "spring-terraces-home-yards":"587c46cd7bfe54fcb96ca0e36dd34732d63b15b74c8c14b3ee260b720281451e","spring-terraces-landmarks":"f8e7e6e6f22310ac1db95324493ef5d3bb39b5d9b4864d1be23ff2f82cfd61b1","spring-terraces-scenery":"37b3a2db70a0da16a6bba4f48bc3be66f985edcff62bd1e9da2c746d1021c12a","spring-terraces-terrain":"e00b7a9078030be6de36563b581b3a8f2944d0100b58d76f046dcffa0da349f5",
  "worn-heartland-home-yards":"bdadc63113ecd94e517cf12c3b279a9f581a09b7ca84a057ef4ac0259af09dae","worn-heartland-landmarks":"3ffe17aa59c5a1be858a747af9137caf4481b67aadac7db0b50fd4c5d843a6ed","worn-heartland-scenery":"36804d363d8113e4e2af548fea1dd1927e0fdc94af8cc05a6ca14cb2f73d7281","worn-heartland-terrain":"4746a72bc80088fdfbee37786b5b084223a2cddb96d064d26e74e4d58c6eb2c4",
});
