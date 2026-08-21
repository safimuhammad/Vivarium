/** Test-owned per-source operation and RGBA authority for V3 support cells. */

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const operation = (cropRect, destination) => ({ cropRect, destination });

export const REGIONAL_R5_V3_OPERATIONS_LITERAL_AUTHORITY = deepFreeze({
  schema: "regional-r5-v3-operations-literal-authority/v1",
  sourceOperations: {
    "ash:bent-rebar": operation([16, 0, 32, 8], [0, 12]),
    "ash:cable-run-a": operation([16, 0, 32, 4], [0, 12]),
    "ash:cable-run-b": operation([8, 0, 32, 4], [0, 17]),
    "ash:containment-relief": operation([0, 0, 28, 28], [2, 2]),
    "ash:service-conduit": operation([20, 0, 32, 10], [0, 11]),
    "ash:snapped-cross-member": operation([20, 0, 32, 8], [0, 11]),
    "ash:world-sealed-filter-box": operation([0, 0, 16, 16], [8, 8]),
    "neutral:v3-explicit-plain-bench": operation([0, 0, 32, 26], [0, 6]),
    "r5-regional/ash-waste/fracture-macro-band": operation([6, 3, 32, 32], [0, 0]),
    "r5-regional/neutral-temperate/plain-boundary-gap": operation([4, 3, 32, 32], [0, 0]),
    "r5-safe/ash-waste/ash-pile/0": operation([0, 0, 32, 27], [0, 2]),
    "r5-safe/ash-waste/ash-pile/1": operation([0, 1, 26, 32], [3, 0]),
    "r5-safe/ash-waste/charred-trunk/0": operation([0, 0, 29, 27], [1, 2]),
    "r5-safe/ash-waste/charred-trunk/1": operation([0, 0, 27, 27], [2, 2]),
    "r5-safe/ash-waste/slag-rock/0": operation([1, 0, 32, 31], [0, 0]),
    "r5-safe/ash-waste/slag-rock/1": operation([0, 4, 32, 32], [0, 0]),
    "r5-safe/ash-waste/slag-rock/2": operation([1, 2, 32, 32], [0, 0]),
    "r5-safe/dry-scrub/deadwood/0": operation([0, 6, 26, 32], [3, 0]),
    "r5-safe/dry-scrub/deadwood/1": operation([2, 7, 32, 32], [0, 0]),
    "r5-safe/dry-scrub/deadwood/2": operation([0, 1, 31, 32], [0, 0]),
    "r5-safe/dry-scrub/deadwood/3": operation([0, 0, 26, 27], [3, 2]),
    "r5-safe/dry-scrub/dry-grass/0": operation([0, 0, 23, 32], [4, 0]),
    "r5-safe/dry-scrub/dry-grass/1": operation([0, 2, 29, 32], [1, 0]),
    "r5-safe/dry-scrub/dry-grass/2": operation([0, 0, 32, 27], [0, 2]),
    "r5-safe/dry-scrub/dry-grass/3": operation([0, 1, 27, 32], [2, 0]),
    "r5-safe/dry-scrub/sun-rock/0": operation([2, 0, 32, 31], [0, 0]),
    "r5-safe/dry-scrub/sun-rock/1": operation([0, 0, 19, 20], [6, 6]),
    "r5-safe/neutral-temperate/broad-tree/0": operation([0, 0, 30, 30], [1, 1]),
    "r5-safe/neutral-temperate/broad-tree/1": operation([1, 3, 32, 32], [0, 0]),
    "r5-safe/neutral-temperate/field-rock/0": operation([0, 0, 32, 28], [0, 2]),
    "r5-safe/neutral-temperate/field-rock/1": operation([0, 0, 19, 19], [6, 6]),
    "r5-safe/neutral-temperate/field-rock/2": operation([0, 0, 27, 26], [2, 3]),
    "r5-safe/neutral-temperate/wildflower/0": operation([0, 0, 22, 31], [5, 0]),
    "r5-safe/neutral-temperate/wildflower/1": operation([0, 0, 19, 24], [6, 4]),
    "r5-safe/neutral-temperate/wildflower/2": operation([0, 0, 20, 24], [6, 4]),
    "r5-safe/neutral-temperate/wildflower/3": operation([0, 0, 27, 27], [2, 2]),
    "r5-safe/worn-heartland/faded-flower/0": operation([0, 0, 23, 31], [4, 0]),
    "r5-safe/worn-heartland/faded-flower/1": operation([0, 0, 20, 25], [6, 3]),
    "r5-safe/worn-heartland/faded-flower/2": operation([0, 0, 19, 23], [6, 4]),
    "r5-safe/worn-heartland/faded-flower/3": operation([0, 0, 16, 19], [8, 6]),
    "r5-safe/worn-heartland/fallen-fence/0": operation([9, 0, 32, 26], [0, 3]),
    "r5-safe/worn-heartland/fallen-fence/1": operation([0, 0, 20, 25], [6, 3]),
    "r5-safe/worn-heartland/old-oak/0": operation([0, 3, 32, 32], [0, 0]),
    "r5-safe/worn-heartland/old-oak/1": operation([0, 0, 30, 30], [1, 1]),
    "r5-safe/worn-heartland/old-oak/2": operation([0, 2, 32, 32], [0, 0]),
    "r5-safe/worn-heartland/old-oak/3": operation([0, 0, 30, 31], [1, 0]),
    "r5-safe/worn-heartland/worn-stone/0": operation([1, 0, 32, 30], [0, 1]),
    "r5-safe/worn-heartland/worn-stone/1": operation([0, 0, 20, 20], [6, 6]),
    "r5-safe/worn-heartland/worn-stone/2": operation([0, 0, 28, 27], [2, 2]),
    "r5-safe/worn-heartland/worn-stone/3": operation([0, 0, 22, 24], [5, 4]),
    "spring:v10-support-00": operation([2, 2, 32, 32], [0, 0]),
    "spring:v10-support-01": operation([0, 0, 24, 24], [4, 4]),
    "spring:v10-support-02": operation([0, 0, 28, 28], [2, 2]),
    "spring:v10-support-03": operation([2, 2, 32, 32], [0, 0]),
    "spring:v10-support-04": operation([4, 4, 32, 32], [0, 0]),
    "spring:v10-support-05": operation([4, 4, 32, 32], [0, 0]),
    "spring:v10-support-06": operation([0, 0, 28, 28], [2, 2]),
    "spring:v10-support-07": operation([2, 2, 32, 32], [0, 0]),
    "spring:v10-support-08": operation([4, 4, 32, 32], [0, 0]),
    "spring:v10-support-09": operation([0, 0, 24, 24], [4, 4]),
    "spring:v10-support-10": operation([2, 2, 32, 32], [0, 0]),
    "spring:v10-support-11": operation([0, 0, 28, 28], [2, 2]),
    "spring:v10-support-12": operation([0, 0, 28, 28], [2, 2]),
    "spring:v10-support-13": operation([4, 4, 32, 32], [0, 0]),
    "spring:v10-support-14": operation([2, 2, 32, 32], [0, 0]),
    "spring:v10-support-15": operation([0, 0, 28, 28], [2, 2]),
  },
  roleOverrides: {
    "ash-waste/fissure-return/r5-regional/ash-waste/fracture-macro-band": operation(
      [0, 3, 32, 32],
      [0, 0],
    ),
  },
  sourceRgbaSha256: {
      "ash:bent-rebar": "c24024be0c0c6fe2b1fd6fdb33b5da14d5d30ee70438a8c55828c374bb996d7e",
      "ash:cable-run-a": "a6009723c3ef71756004fcf2218e906fc442842aaab86c6b070e16ddf54e76d8",
      "ash:cable-run-b": "017cf8b0162d0c2a21c18ff450039ae0a428e27f3328e817f77b6185fb5a76d4",
      "ash:containment-relief": "9c65614089ccd2bd1cc985eed290b5738d46573d8d963a0decdc8899c6ec4d5d",
      "ash:service-conduit": "e87ac8f5f9fcff17eb3eeac3a5a4f60a92fa74ae7126975335e4efd84206e96a",
      "ash:snapped-cross-member": "6a8407ab7079ea76098f5b94f0f0e59cf9d2da82019e927fadae81b9ec53140b",
      "ash:world-sealed-filter-box": "318553353aeaff215b2486e26de9271b36e5fb5833883a83a3f6fb1d37b6f024",
      "neutral:v3-explicit-plain-bench": "09b5fea777b4e6c3dd56a23c09430bfb4907168afe264d61694d8bf70a6410ef",
      "r5-regional/ash-waste/fracture-macro-band": "549384b4c5a283297b9140e17cdfd2ef86b5e13246f3614c6ccbaad2e938a09d",
      "r5-regional/neutral-temperate/plain-boundary-gap": "922d850fb6f27ae0f93e8360d694224677f0ce7a141c83f7be39a0be010411b5",
      "r5-safe/ash-waste/ash-pile/0": "012909d3b003aa2d6d647eeda9932865505b737ebf6920f7e6094610aade89a6",
      "r5-safe/ash-waste/ash-pile/1": "6bf5ebabb059983ef2979a40e247a8c23fad6604b002d3b7e50a9561311b5655",
      "r5-safe/ash-waste/charred-trunk/0": "4b2ecc58e11d0fc2564a1ecfd3d2809ad8865b26f523e3ea9c13893196b2324b",
      "r5-safe/ash-waste/charred-trunk/1": "7025c325313a243f41a62d2659221efdb0f6fad763b3f268bbec4b837dd42c43",
      "r5-safe/ash-waste/slag-rock/0": "2220b5ca25e9cd2074ef94104886e7926ac8ce64362d38631b0b87ea519174b4",
      "r5-safe/ash-waste/slag-rock/1": "2c5b6ca3bde0d3c3fe9984530fb951e45b43b0442cf0fc7a8c0edc48ff5339f1",
      "r5-safe/ash-waste/slag-rock/2": "daece58490e396870c1da4ce7ba1af01cb939249f93d5ffc57034ae6c6abe298",
      "r5-safe/dry-scrub/deadwood/0": "5ba102bf1e96d16c5074792c5ecfa0070a7047d1e9fa80c8c486171496a7b664",
      "r5-safe/dry-scrub/deadwood/1": "c2d7c5343f32a0bada2fe7f71e3a313a283d07bd1b6741d306736ac57be4c6e0",
      "r5-safe/dry-scrub/deadwood/2": "772001a47be17f08fa75b2f8adfdae875117dce0a52c0c248f55678c6b0467bf",
      "r5-safe/dry-scrub/deadwood/3": "600ba97d9fb19f9a184e0918b0d16e0508323cbd88fc4c5f158b28d1cef130f0",
      "r5-safe/dry-scrub/dry-grass/0": "719fec5196e15d0f6f4655fd3f45731e526f85e711e0b2b369d7f0c8691d9a62",
      "r5-safe/dry-scrub/dry-grass/1": "adc5580117fd93c35dbca53a8285dd5a7ea2552780cd89e4aa277010b96a1f1c",
      "r5-safe/dry-scrub/dry-grass/2": "a27eea5e04392909dad36848a79a57db55c47a2c4860b61f73dacfdaecca14a1",
      "r5-safe/dry-scrub/dry-grass/3": "71d94cee57f8600e8f08be7cbdc04c90c9817e8f6529d50b298afcb9bd9bd041",
      "r5-safe/dry-scrub/sun-rock/0": "31efa1f4fb18ba66b3ae55dd080e148935048083db68cb93aaa5ff59d9ce41da",
      "r5-safe/dry-scrub/sun-rock/1": "7311b87b538780ff5f253baf57b0cf3f695010769f310756e10698bac7d7bd0c",
      "r5-safe/neutral-temperate/broad-tree/0": "f71c73827f805912a4d3595b4e7175dda2208f1ba12db5976023126e651e09c9",
      "r5-safe/neutral-temperate/broad-tree/1": "6735255037b78055a0125a674e352964796dbaf237e9186b41b4e0777bd5975f",
      "r5-safe/neutral-temperate/field-rock/0": "cea117a67938b8d890029bcee062a190d73683e2d5e3514f380ae2a51e010820",
      "r5-safe/neutral-temperate/field-rock/1": "8f3a41115e8cdaf6c99898d8b28728f98d82c241ad397f31a7072ddf301bccf5",
      "r5-safe/neutral-temperate/field-rock/2": "eefde46f21c3e9a859b80a759a33433ae64f66cdaac5c401535c3a010d52c5e3",
      "r5-safe/neutral-temperate/wildflower/0": "81a8d5526322d09042b2050ae55402a9be1d0b35a19a33344380b190463bcf00",
      "r5-safe/neutral-temperate/wildflower/1": "6e81de7b0c11bf132434ec9dc9c36022a00f34469a490fafdbc6e16545166df7",
      "r5-safe/neutral-temperate/wildflower/2": "16cae135bf2737f04f4a8524bb29d32e989ecd9476b7f491dbaeaed3935115c5",
      "r5-safe/neutral-temperate/wildflower/3": "2031ea41f6dfc4bc9202af36dfa9703f438e07f403d0563f1d3030fd3fd70b4b",
      "r5-safe/worn-heartland/faded-flower/0": "bd523aa74a5d962b08b0301079a7250faeea0b9d1e426f7d4a7f310a0c7e4015",
      "r5-safe/worn-heartland/faded-flower/1": "7ec33dcaed8a5f31d685328c30384d120525a122358823eab1c2283b9a41dfaa",
      "r5-safe/worn-heartland/faded-flower/2": "ba0214ae2fb9394e94b44824248ac1419cb7a8323e15a397eb20c01cac19fd4b",
      "r5-safe/worn-heartland/faded-flower/3": "b1fb1837dd95030fe0c12e6dc2d9cbd014cbb9719cac4f7e723b36b1428f90c3",
      "r5-safe/worn-heartland/fallen-fence/0": "8f9037ae8e6ae167ca3fa03273aa3d7cb1b9fabac509385a42d6cdb64ef8f857",
      "r5-safe/worn-heartland/fallen-fence/1": "9a186c5f7c76fd6d51ed67a312215f2dc590391404597a8acabe834bf6872403",
      "r5-safe/worn-heartland/old-oak/0": "b4a9d221bf573d02d365902bd12977e31cdc364de3ba94da23ba3d6dbc696f67",
      "r5-safe/worn-heartland/old-oak/1": "a22e9512ae14dec682b4920d85923d9d3b66bf31dd9f0d6f1993426f4f93b4bd",
      "r5-safe/worn-heartland/old-oak/2": "d4282abaab154c833d8866d29ef1ff4490f0efad03cc12940c4dbe977b4ac462",
      "r5-safe/worn-heartland/old-oak/3": "6694116482913df794ca7d3c08c02f940cb42681cf785c8080746f8e982e781b",
      "r5-safe/worn-heartland/worn-stone/0": "548dde752335658447adea488994f2fb2828496c586565e0dea597b833f32035",
      "r5-safe/worn-heartland/worn-stone/1": "76527f399ba292b72c6f879cd44ba7a66a4a001ecd46bb106d261824bee0a4be",
      "r5-safe/worn-heartland/worn-stone/2": "c9f1d1a933624aa379c21e63194c09154b4dbe7f0d51c1a4c1f4d1287d8bd3c1",
      "r5-safe/worn-heartland/worn-stone/3": "2fb314f58e217024917998a6e6ca4fa7f4b02b0b48b61c37709d697d1d7361af",
      "spring:v10-support-00": "233a9a7e5f2013bafdc5ea490fc24387d72ae992a6b1ae8bd90e803a5e32de3c",
      "spring:v10-support-01": "4460a8492fc06b880b8667719131b18eb9ddb12bff4f1ca8e9bc248c0b1f6c12",
      "spring:v10-support-02": "4118dc6c11ef1b312f59cc797cf728cd3096c8ae9b62f2c8a9f22eeadcd5605c",
      "spring:v10-support-03": "8590cd16af37d026dc617ff72402a237e17f16e827b9337ce78b83b0be867a2e",
      "spring:v10-support-04": "59db204bbc39ef25bef355d03ddb1ca1cc1892d3e91c2fcce6c5689ce81ce2ff",
      "spring:v10-support-05": "912595a981a9fe9e8f062e6363cd45e078701118c4b1a2857bb3f38644c1e448",
      "spring:v10-support-06": "512cd050dd1f2e67ad5f83c1b16b642db7b0ca9f9282c2db75c12b6cc6e6aceb",
      "spring:v10-support-07": "03d92279e4d369733b93ab02f8233b3dece1bd6b6fc4e1bafa138d745fd3ae3f",
      "spring:v10-support-08": "e2da149ffe2dd207b08dac5d3513196e37002f471cade5441d339f1f6cf7fdd8",
      "spring:v10-support-09": "3f7cd24684e25d9cd56fbac514514e29703064807bada468d09da484db14f12f",
      "spring:v10-support-10": "ec28cd4824c96d2471f9288d85f9251b848f230a06d743a17bfe090a2579739f",
      "spring:v10-support-11": "512cd050dd1f2e67ad5f83c1b16b642db7b0ca9f9282c2db75c12b6cc6e6aceb",
      "spring:v10-support-12": "b7628ff19afe7d07443337016e1b06a99809ff154e6e46b4cd75616fad7d9a78",
      "spring:v10-support-13": "90ff0f06ef4f511a9b2f2d24ece5ed6b0dae5725b6db4a2d6fe3a19c1fdc0033",
      "spring:v10-support-14": "566a1c4a643360fd1f379e3b21ba611daef12ff43a08a39ecf4f35ea38f9708c",
      "spring:v10-support-15": "8ea098ec9fbe685330a27a1e80c7310149652a756eb64de1df27345719b7091a"
  },
  resultCells: {
      "worn-heartland": [
          [
              4,
              "root-mound",
              "c66271e680c2697297cd44ba989e917921e6968b5b576b7d6826c8cd72114772"
          ],
          [
              8,
              "support-tree",
              "69aac8e443ac170c21ec7760e31fc1add17e625a1b301797a1e47778808c016e"
          ],
          [
              3,
              "broken-fence-return",
              "2f42afeec94189c886e73c21707a5591135c9da359c69ba81416247034b3a9c1"
          ],
          [
              2,
              "faded-flower",
              "a92e5529ebca552e8853f961a0e3613c679e8eea0c2986eec42a26b2d6e42abf"
          ],
          [
              1,
              "rut-stone",
              "75753e35cb9425513121626653419153b73ab5f5d767f6dcb299e4e519685f82"
          ],
          [
              6,
              "eroded-tuft",
              "ca0cca37d152dfd4739476efab5b4e4752ad83c971337130bc4fa45e09053e64"
          ],
          [
              12,
              "woodpile",
              "a8209335b319df2fdc5e87ded7a13a2d1dbcb3c658af7a54211a2f9816d29e0e"
          ],
          [
              5,
              "field-stone",
              "90d2333ed75769e9a6531211ce2a100edebbdb676f8aa98927f482545302e15c"
          ],
          [
              65,
              "wind-root-return",
              "85d1eae15584248f34e9d4f9708f7aa9b3722771faccc0bf93c50d5eac1d3948"
          ],
          [
              70,
              "wind-tree-return",
              "69aac8e443ac170c21ec7760e31fc1add17e625a1b301797a1e47778808c016e"
          ],
          [
              19,
              "garden-fence-return",
              "2f42afeec94189c886e73c21707a5591135c9da359c69ba81416247034b3a9c1"
          ],
          [
              23,
              "garden-flower-return",
              "a92e5529ebca552e8853f961a0e3613c679e8eea0c2986eec42a26b2d6e42abf"
          ],
          [
              83,
              "boundary-post-return",
              "2f42afeec94189c886e73c21707a5591135c9da359c69ba81416247034b3a9c1"
          ],
          [
              87,
              "boundary-stone-return",
              "75753e35cb9425513121626653419153b73ab5f5d767f6dcb299e4e519685f82"
          ],
          [
              85,
              "route-stone-return",
              "90d2333ed75769e9a6531211ce2a100edebbdb676f8aa98927f482545302e15c"
          ],
          [
              89,
              "route-flower-return",
              "57ea9d5336c188d4fb14d6518517d435425e50c8e74db748447fb85313e3897c"
          ]
      ],
      "spring-terraces": [
          [
              0,
              "stone-bank",
              "78bc4c04fce5ba7ca7e56085c14a42f9f6a9a2cd1312e74a5f69f50e4f95c1c4"
          ],
          [
              4,
              "ripple-return",
              "9cc284c3959d49e6a8ba69adf0553a8feb17539dd25858e249247822ab867350"
          ],
          [
              16,
              "upper-lip",
              "727a7c6dde41c3213f8910c771816dc692e4901b6ef0fac901f2da037e3c2ae6"
          ],
          [
              20,
              "fall-foam",
              "5806e3243202e57de77d83e174f40339a2d6984e41feb20c9557730bbbf75df9"
          ],
          [
              64,
              "wet-slab",
              "048c091df0992cf92eea72c5d0065321a571f458b84caca0639743cb617ca5fe"
          ],
          [
              68,
              "stone-riser",
              "32514b2373ea6da73a6a5193561745fbda08c1d7d176db3297c54e8ea76c9880"
          ],
          [
              7,
              "reed-root",
              "a6ea9cc878f048c7e6966aad188149ce541b7653cdad2300fe0a1d9445d777d1"
          ],
          [
              8,
              "silt-bank",
              "4544eccaf506e944e4dafafde8ef8ec841b5ac6cda95af1951e826dffd6e8e8e"
          ],
          [
              1,
              "root-return",
              "4c1a2e5f13af42f868ec3b2dcf699fcfad029c5502738837bb53da658ccda6b2"
          ],
          [
              3,
              "hanging-reed",
              "c16384fd9a3e974be05efab0b82915074f3e576162317896f53b3e732abea770"
          ],
          [
              69,
              "root-return",
              "95e9f3c4114ecee6209138d0be4e0bb33cf1d8bdc0cec3f19f1636976201bbb7"
          ],
          [
              73,
              "reed-return",
              "a6ea9cc878f048c7e6966aad188149ce541b7653cdad2300fe0a1d9445d777d1"
          ],
          [
              70,
              "bank-junction",
              "9f7b7b9038dffcea5801e76d9212be1c700bc8af010fbfe5144628bcb8134f43"
          ],
          [
              74,
              "stone-return",
              "c122ca144ff9569c1f5f7686c272a57c2e2d289100e8975878cb7f26b115610d"
          ],
          [
              71,
              "west-abutment",
              "10827bb0639027ea5cc70e0afe041397a8d4eeb2e2d4ce7a0038f62f78a3ef25"
          ],
          [
              75,
              "east-abutment",
              "8009492e2eb8f0750d5e42cc3b068b4b267bd06729b3b8d5fdfa070f51627f7b"
          ]
      ],
      "dry-scrub": [
          [
              0,
              "sandstone-chip",
              "13e1a897afd012879cf430145361caf29b6f0f2ca6bc6c092ffa0f51a2403c9b"
          ],
          [
              4,
              "pebble-fan",
              "13e1a897afd012879cf430145361caf29b6f0f2ca6bc6c092ffa0f51a2403c9b"
          ],
          [
              9,
              "deadwood-root",
              "e7308e4772efc0efb949fa5da5d96b228129cf4ffa4288062172d06309273765"
          ],
          [
              11,
              "thorn-return",
              "29d6fe0893e2a2242f231e55e0e91567a3c264f1cf1a991c4db3dde9f7837420"
          ],
          [
              2,
              "wind-scrub",
              "c7d406e196c78652cd3841fba5c42c2d2269238375c8fb818e24b08f07219300"
          ],
          [
              6,
              "sand-ripple",
              "a8d73cb5b7a655cde0f63c50aecfac426214e1a56c2b824006626ce816e44ad0"
          ],
          [
              8,
              "windbreak-stone",
              "13e1a897afd012879cf430145361caf29b6f0f2ca6bc6c092ffa0f51a2403c9b"
          ],
          [
              5,
              "shade-post",
              "0251850eadc6a63ee25020d5fa7f37988d38e2ba478e9dc44da29a67fc6c467a"
          ],
          [
              16,
              "ridge-stone-return",
              "13e1a897afd012879cf430145361caf29b6f0f2ca6bc6c092ffa0f51a2403c9b"
          ],
          [
              20,
              "ridge-pebble-return",
              "13e1a897afd012879cf430145361caf29b6f0f2ca6bc6c092ffa0f51a2403c9b"
          ],
          [
              65,
              "deadwood-return",
              "d8edc1029b7423cfaf6dfe89084a8ce9ea79de3686815e072c80c09ced230e9d"
          ],
          [
              69,
              "scrub-return",
              "29d6fe0893e2a2242f231e55e0e91567a3c264f1cf1a991c4db3dde9f7837420"
          ],
          [
              82,
              "wind-grass-return",
              "c7d406e196c78652cd3841fba5c42c2d2269238375c8fb818e24b08f07219300"
          ],
          [
              86,
              "sand-ripple-return",
              "a8d73cb5b7a655cde0f63c50aecfac426214e1a56c2b824006626ce816e44ad0"
          ],
          [
              98,
              "south-grass-return",
              "c7d406e196c78652cd3841fba5c42c2d2269238375c8fb818e24b08f07219300"
          ],
          [
              102,
              "south-stone-return",
              "13e1a897afd012879cf430145361caf29b6f0f2ca6bc6c092ffa0f51a2403c9b"
          ]
      ],
      "ash-waste": [
          [
              2,
              "crater-ejecta",
              "b9a41fb74ffb0d5394eb912f172fa0f0347b59afbbedb634e804a7d2e9c44502"
          ],
          [
              3,
              "coral-fissure",
              "ed883ca6c866b9676426d46541bbba33e0f0e1fc6c61b6dfe657808fb831deb8"
          ],
          [
              1,
              "snapped-insulator",
              "555b58a20441808265d9a8656657d1535bd5dd15946c92006027c74727e5b813"
          ],
          [
              0,
              "cable-scrap",
              "4bcab30e82a8938363a69c6a2323073e316d58c05c91cd58744a624314d4bcb9"
          ],
          [
              5,
              "slag-patch",
              "9be7ae76d085ddf60dfa926bc05964e6e5f3e9ddd4fc70fc339eeed156eeb57b"
          ],
          [
              4,
              "bent-rebar",
              "c26fe5308195fffac045d9b9193b823e6a2030da5c8f13fa5231270ec190524c"
          ],
          [
              7,
              "sealed-filter-box",
              "ea97aaa34e16eb7584e4a4208048a54a62b22c1e67cd368483e1149473100b06"
          ],
          [
              8,
              "collapsed-conduit",
              "867fdf7dcd7955b7f877e90301eb7c71031f639c7f92f1c8ee28b90e9bae27d1"
          ],
          [
              18,
              "crater-ejecta-return",
              "b9a41fb74ffb0d5394eb912f172fa0f0347b59afbbedb634e804a7d2e9c44502"
          ],
          [
              22,
              "fissure-return",
              "a57ca92e08f6a7eaa92a3fb447e83b765f863b2f836edfb006f63a100b585a60"
          ],
          [
              65,
              "pylon-slag-return",
              "9be7ae76d085ddf60dfa926bc05964e6e5f3e9ddd4fc70fc339eeed156eeb57b"
          ],
          [
              69,
              "pylon-cable-return",
              "4bcab30e82a8938363a69c6a2323073e316d58c05c91cd58744a624314d4bcb9"
          ],
          [
              81,
              "slag-stone-return",
              "9be7ae76d085ddf60dfa926bc05964e6e5f3e9ddd4fc70fc339eeed156eeb57b"
          ],
          [
              85,
              "rebar-return",
              "c26fe5308195fffac045d9b9193b823e6a2030da5c8f13fa5231270ec190524c"
          ],
          [
              96,
              "debris-char-return",
              "719d177fc0988c966743c7260455c2608d6c16343913f0ac1f92f03e37758555"
          ],
          [
              100,
              "debris-filter-return",
              "229a11d35f1a3cbc63990b008f1a662e6a87f59b4d2d659d58aa1f22ad29a7f7"
          ]
      ],
      "neutral-temperate": [
          [
              3,
              "open-understory",
              "6a69e7cdbf86a81238c41584eeed725fae4052689fcd66f54a7804be40216a18"
          ],
          [
              0,
              "secondary-tree",
              "09c0a4530ad86e928d5680b69d7fe047535a484a52fd17ff2ae465c9830a2fad"
          ],
          [
              9,
              "field-stone-return",
              "09010a8e7a97d01244bb658ea4931df95c29aeaf7033c6e920b54a4fc6828be6"
          ],
          [
              11,
              "hedgerow-return",
              "122634ae1c6855d88d11793e7b568d8bc09f1af001b72da71f89289a38b0c477"
          ],
          [
              10,
              "wildflower-gap",
              "3b8610e276df08da68f5a979ea2dccd4ba277d9db2dfe5d953316e3092dbb3ea"
          ],
          [
              12,
              "damp-verge",
              "6a69e7cdbf86a81238c41584eeed725fae4052689fcd66f54a7804be40216a18"
          ],
          [
              4,
              "plain-bench",
              "1d39c17dce3e3001461271c2772f41e0a532441d529ecce6b435e574953c7f0a"
          ],
          [
              6,
              "herb-bed",
              "841a37e751cb80ed812f0f03e30d6c5700d0f65e25e5032ff7d7340b348c38e2"
          ],
          [
              16,
              "grove-tree-return",
              "09c0a4530ad86e928d5680b69d7fe047535a484a52fd17ff2ae465c9830a2fad"
          ],
          [
              20,
              "grove-understory-return",
              "6a69e7cdbf86a81238c41584eeed725fae4052689fcd66f54a7804be40216a18"
          ],
          [
              65,
              "wall-stone-return",
              "09010a8e7a97d01244bb658ea4931df95c29aeaf7033c6e920b54a4fc6828be6"
          ],
          [
              69,
              "wall-gap-return",
              "7f18e711e40d7b3e2c9b1b50a0b3311b30c36879e108dc1f89231d1b763509d1"
          ],
          [
              82,
              "verge-flower-return",
              "6a69e7cdbf86a81238c41584eeed725fae4052689fcd66f54a7804be40216a18"
          ],
          [
              86,
              "verge-herb-return",
              "841a37e751cb80ed812f0f03e30d6c5700d0f65e25e5032ff7d7340b348c38e2"
          ],
          [
              98,
              "south-flower-return",
              "6a69e7cdbf86a81238c41584eeed725fae4052689fcd66f54a7804be40216a18"
          ],
          [
              102,
              "south-stone-return",
              "09010a8e7a97d01244bb658ea4931df95c29aeaf7033c6e920b54a4fc6828be6"
          ]
      ]
  },
});

export const REGIONAL_R5_V3_OPERATIONS_LITERAL_AUTHORITY_SHA256 =
  "9605113bb5ebda7ddf6fa4c07a93ca3250e0e3bca765d0e1537e19eb51a16815";
