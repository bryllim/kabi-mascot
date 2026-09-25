// Subset of the Rive core schema (runtime format 7.x) used by this project.
// Type and property keys come from rive-runtime's generated *_base.hpp files.
// Field types: uint = varuint, double = float32, string, color = uint32 ARGB, bool = byte.

export const TYPES = {
  Backboard: 23,
  Artboard: 1,
  Node: 2,
  Shape: 3,
  Ellipse: 4,
  Rectangle: 7,
  PointsPath: 16,
  StraightVertex: 5,
  CubicDetachedVertex: 6,
  Fill: 20,
  Stroke: 24,
  SolidColor: 18,
  CubicEaseInterpolator: 28,
  LinearAnimation: 31,
  KeyedObject: 25,
  KeyedProperty: 26,
  KeyFrameDouble: 30,
  KeyFrameColor: 37,
  StateMachine: 53,
  StateMachineNumber: 56,
  StateMachineTrigger: 58,
  StateMachineBool: 59,
  StateMachineLayer: 57,
  AnyState: 62,
  EntryState: 63,
  ExitState: 64,
  AnimationState: 61,
  StateTransition: 65,
  TransitionTriggerCondition: 68,
  TransitionNumberCondition: 70,
  TransitionBoolCondition: 71,
  BlendState1DInput: 76,
  BlendAnimation1D: 75,
  Bone: 40,
  RootBone: 41,
  Skin: 43,
  Tendon: 44,
  CubicWeight: 46,
};

// name -> [propertyKey, fieldType]. Some keys share a name across types, so
// type-specific names are prefixed (e.g. vertexX vs x).
export const PROPS = {
  // Component
  name: [4, 'string'],
  parentId: [5, 'uint'],
  // LayoutComponent / Artboard
  width: [7, 'double'],
  height: [8, 'double'],
  originX: [11, 'double'],
  originY: [12, 'double'],
  clip: [196, 'bool'],
  defaultStateMachineId: [236, 'uint'],
  // Node / TransformComponent / WorldTransformComponent
  x: [13, 'double'],
  y: [14, 'double'],
  rotation: [15, 'double'],
  scaleX: [16, 'double'],
  scaleY: [17, 'double'],
  opacity: [18, 'double'],
  // Bones / skinning
  length: [89, 'double'],
  rootBoneX: [90, 'double'],
  rootBoneY: [91, 'double'],
  skinXX: [104, 'double'], skinYX: [105, 'double'], skinXY: [106, 'double'],
  skinYY: [107, 'double'], skinTX: [108, 'double'], skinTY: [109, 'double'],
  boneId: [95, 'uint'],
  tendonXX: [96, 'double'], tendonYX: [97, 'double'], tendonXY: [98, 'double'],
  tendonYY: [99, 'double'], tendonTX: [100, 'double'], tendonTY: [101, 'double'],
  weightValues: [102, 'uint'], weightIndices: [103, 'uint'],
  inValues: [110, 'uint'], inIndices: [111, 'uint'], outValues: [112, 'uint'], outIndices: [113, 'uint'],
  // Paths
  pathFlags: [128, 'uint'],
  isClosed: [32, 'bool'],
  vertexX: [24, 'double'],
  vertexY: [25, 'double'],
  radius: [26, 'double'],
  inRotation: [84, 'double'],
  inDistance: [85, 'double'],
  outRotation: [86, 'double'],
  outDistance: [87, 'double'],
  // ParametricPath
  pathWidth: [20, 'double'],
  pathHeight: [21, 'double'],
  pathOriginX: [123, 'double'],
  pathOriginY: [124, 'double'],
  // Paint
  isVisible: [41, 'bool'],
  fillRule: [40, 'uint'],
  thickness: [47, 'double'],
  cap: [48, 'uint'],
  join: [49, 'uint'],
  transformAffectsStroke: [50, 'bool'],
  colorValue: [37, 'color'],
  // Interpolator
  x1: [63, 'double'],
  y1: [64, 'double'],
  x2: [65, 'double'],
  y2: [66, 'double'],
  // Animation
  animationName: [55, 'string'],
  fps: [56, 'uint'],
  duration: [57, 'uint'],
  speed: [58, 'double'],
  loopValue: [59, 'uint'],
  objectId: [51, 'uint'],
  propertyKey: [53, 'uint'],
  frame: [67, 'uint'],
  interpolationType: [68, 'uint'],
  interpolatorId: [69, 'uint'],
  keyValue: [70, 'double'],
  keyColor: [88, 'color'],
  // State machine
  smName: [138, 'string'],
  numberValue: [140, 'double'],
  boolValue: [141, 'bool'],
  animationId: [149, 'uint'],
  stateToId: [151, 'uint'],
  transitionFlags: [152, 'uint'],
  transitionDuration: [158, 'uint'],
  exitTime: [160, 'uint'],
  transitionInterpolation: [349, 'uint'],
  transitionInterpolatorId: [350, 'uint'],
  inputId: [155, 'uint'],
  opValue: [156, 'uint'],
  conditionValue: [157, 'double'],
  blendAnimationId: [165, 'uint'],
  blendValue: [166, 'double'],
  blendInputId: [167, 'uint'],
};

// Property keys that animations target (KeyedProperty.propertyKey).
export const ANIMATABLE = {
  x: 13, y: 14, rotation: 15, scaleX: 16, scaleY: 17, opacity: 18,
  vertexX: 24, vertexY: 25, thickness: 47, colorValue: 37,
  rootBoneX: 90, rootBoneY: 91,
};

export const LOOP = { oneShot: 0, loop: 1, pingPong: 2 };
export const INTERP = { hold: 0, linear: 1, cubic: 2 };
export const TRANSITION_FLAGS = {
  disabled: 1, durationIsPercentage: 2, enableExitTime: 4,
  exitTimeIsPercentage: 8, pauseOnExit: 16, enableEarlyExit: 32,
};
export const OP = { eq: 0, ne: 1, lte: 2, gte: 3, lt: 4, gt: 5 };
