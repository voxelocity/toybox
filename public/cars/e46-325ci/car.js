// BMW 325Ci Coupe (E46), US market, 2001-2003 pre-facelift.
// Everything the simulation and the fitment checks need about the stock car.
// Sources are listed per value; "est" marks engineering estimates.

export const car = {
  id: 'e46-325ci',
  make: 'BMW',
  model: '325Ci',
  chassis: 'E46',
  bodyStyle: 'Coupe',
  years: '2001-2003 (pre-facelift)',
  market: 'US',
  title: 'BMW 325Ci Coupe',
  subtitle: 'E46 · 2001-2003 · M54B25 inline-six',
  engine: 'm54b25',

  specs: {
    curbWeightKg: 1450,          // 3,197 lb, 2003 325Ci 5MT (carspecs.us / BMW NA)
    autoExtraKg: 35,             // 3,274 lb listed for the Steptronic car
    frontFrac: 0.505,            // BMW quotes 50.3/49.7 for the 325i sedan; coupe owners report ~51/49 (est)
    cgHeightM: 0.51,             // est
    wheelbaseMm: 2725, lengthMm: 4488, widthMm: 1757, heightMm: 1369,
    trackFrontMm: 1471, trackRearMm: 1478,
    cd: 0.30,                    // published figures range 0.29-0.32
    areaM2: 2.12,                // calibrated so the 141 kW EU car reaches BMW's 240 km/h
    crr: 0.012,
    fuelTankL: 63,
    speedLimitMph: 128,          // US 325 models are governed at 128 mph by the DME
    driverKg: 80,
  },

  transmissions: {
    '5mt': {
      id: '5mt', label: '5-speed manual', model: 'Getrag S5D 250G',
      ratios: [4.23, 2.52, 1.66, 1.22, 1.0], reverse: 4.04, finalDrive: 3.15,
      driveEff: 0.90, shiftTimeS: 0.30, auto: false, launchRpm: 4500,
    },
    '5at': {
      id: '5at', label: '5-speed Steptronic automatic', model: 'GM 5L40-E',
      ratios: [3.67, 2.0, 1.41, 1.0, 0.74], reverse: 4.10, finalDrive: 3.46,
      driveEff: 0.86, shiftTimeS: 0.18, auto: true, launchRpm: 2400,
    },
  },
  gearSources: 'Gear and final-drive ratios per BMW sales literature, compiled by MyE46.com',

  stock: {
    transmission: '5mt',
    wheels: { design: 'bmw-style-43', front: { d: 16, w: 7, et: 47 }, rear: { d: 16, w: 7, et: 47 }, finish: 'silver' },
    sportPackageWheels: { design: 'bmw-style-44', front: { d: 17, w: 8, et: 47 }, rear: { d: 17, w: 8, et: 47 }, finish: 'silver' },
    tires: { model: 'factory-allseason', front: '205/55R16', rear: '205/55R16' },
    sportPackageTires: { model: 'factory-performance', front: '225/45R17', rear: '225/45R17' },
    brakes: {
      front: { rotorD: 300, rotorT: 22, vented: true, caliper: { type: 'floating', pistons: 1, color: '#4a4b4d' }, label: '300 x 22 mm vented, single-piston floating' },
      rear: { rotorD: 294, rotorT: 19, vented: true, caliper: { type: 'floating', pistons: 1, color: '#4a4b4d' }, label: '294 x 19 mm vented, single-piston floating' },
    },
    clutchNm: 350,                // est: 228 mm OE clutch, typically sized ~1.4x rated torque
    flywheelLb: 24.4,             // dual-mass (reported)
    engineInertia: 0.10,
    alignment: { camberFront: -0.33, camberRear: -1.83 },
  },

  // Wheel fitment geometry (mm from the hub face, + = outboard)
  fitment: {
    boltPattern: '5x120', centreBore: 72.56, lug: 'M12x1.5 bolts',
    hubFaceW: { front: 1471 / 2 + 47, rear: 1478 / 2 + 47 },
    // effective outer edge of the tyre at the fender lip (after camber) that
    // clears without work, and with rolled / pulled fenders. Calibrated to
    // Apex Race Parts' E46 non-M fitment guide.
    outer: { front: 84, frontRolled: 90, frontPulled: 99, rear: 83, rearRolled: 91, rearPulled: 101 },
    // tyre inner edge to strut / spring perch
    inner: { front: 168, frontReducedByCoilovers: 157, rear: 185 },
    maxDiameterMm: 668, // outside diameter that clears the liners at stock height
    minWheelForBrakes: { stock: 15, 'oem-330': 17, 'stoptech-st40': 17, 'stoptech-st40r': 17, 'brembo-gt-355': 18 },
    source: 'Apex Race Parts E46 3 Series wheel & tyre fitment guide (direct-fit and camber/roll thresholds)',
  },

  factoryOptions: {
    sportPackage: { label: 'Sport Package', note: '17x8 Style 44, 225/45R17 performance tyres, sport seats, 3-spoke sport steering wheel' },
    xenon: { label: 'Bi-xenon headlights', note: 'Auto-levelling bi-xenon low beams' },
    moonroof: { label: 'Power moonroof', note: 'Premium Package item' },
  },

  paints: [
    { code: '300', name: 'Alpine White III', hex: '#f1f2ee', finish: 'solid' },
    { code: '668', name: 'Jet Black', hex: '#0b0b0c', finish: 'solid' },
    { code: '475', name: 'Black Sapphire Metallic', hex: '#131519', finish: 'metallic' },
    { code: '354', name: 'Titanium Silver Metallic', hex: '#b4b7b9', finish: 'metallic' },
    { code: '400', name: 'Steel Grey Metallic', hex: '#6d7175', finish: 'metallic', to: '02/2003' },
    { code: 'A08', name: 'Silver Grey Metallic', hex: '#8f9497', finish: 'metallic', from: '03/2003' },
    { code: '317', name: 'Orient Blue Metallic', hex: '#1f2b49', finish: 'metallic' },
    { code: '364', name: 'Topaz Blue Metallic', hex: '#2c4877', finish: 'metallic', to: '02/2003' },
    { code: 'A07', name: 'Mystic Blue Metallic', hex: '#2c3b58', finish: 'metallic', from: '02/2003' },
    { code: '372', name: 'Steel Blue Metallic', hex: '#50667f', finish: 'metallic' },
    { code: '430', name: 'Oxford Green II Metallic', hex: '#1f3429', finish: 'metallic' },
    { code: '442', name: 'Grey Green Metallic', hex: '#6f7b71', finish: 'metallic' },
    { code: '438', name: 'Electric Red', hex: '#b3131c', finish: 'solid' },
  ],
  paintSource: 'BMW colour codes listed for the 2002 3 Series (PaintScratch); on-screen colours are approximations',

  // labour rate default and typical sales tax
  shop: { laborRate: 140, taxRate: 0.0825 },
};
