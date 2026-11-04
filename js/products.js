// Product catalog. Each product with `tryon` gets the live AR "Try it on" button.
export const products = [
  {
    id: 'contrast-hoodie',
    name: 'Contrast Trim Fleece Hoodie',
    category: 'Hoodies',
    price: 4499,
    compareAt: 5999,
    colour: 'Bone / Black trim',
    badge: 'Try on live',
    images: ['assets/hoodie/front.png', 'assets/hoodie/side.png', 'assets/hoodie/back.png'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    description:
      'Heavyweight brushed fleece with a relaxed drop-shoulder fit. Black ribbed cuffs, a layered hem and a lined hood with flat drawcords. Soft inside, holds its shape outside.',
    details: ['320 GSM cotton-blend fleece', 'Relaxed, drop-shoulder fit', 'Kangaroo pocket with contrast piping', 'Machine wash cold, dry flat'],
    tryon: {
      rig: 'assets/hoodie/rig/',
      size: [383, 550],
      // joint positions on the garment's front image (px) — used to bend it to the body
      kp: {
        r_shoulder: [72, 112], l_shoulder: [310, 108],
        r_elbow: [34, 262], l_elbow: [352, 272],
        r_wrist: [92, 398], l_wrist: [346, 432],
        r_hip: [100, 445], l_hip: [288, 445],
      },
    },
  },
];

export const formatPKR = (n) => 'Rs ' + n.toLocaleString('en-PK');
