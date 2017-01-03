/* global AFRAME */

if (typeof AFRAME === 'undefined') {
  throw new Error('Component attempted to register before AFRAME was available.');
}

var bind = AFRAME.utils.bind;
var trackedControlsUtils = AFRAME.utils.trackedControls;
var THREE = AFRAME.THREE;

var DAYDREAM_CONTROLLER_MODEL_OBJ_URL = 'https://cdn.aframe.io/controllers/vive/vr_controller_vive.obj';
var DAYDREAM_CONTROLLER_MODEL_OBJ_MTL = 'https://cdn.aframe.io/controllers/vive/vr_controller_vive.mtl';

var GAMEPAD_ID_PREFIX = 'Daydream Controller';

/* grab smus' orientation arm model constructor */
var OrientationArmModel = require('./OrientationArmModel').default;

/**
 * Daydream Controller component for A-Frame.
 */
AFRAME.registerComponent('daydream-controller', {

  /**
   * Set if component needs multiple instancing.
   */
  multiple: false,

  schema: {
    buttonColor: {default: '#FAFAFA'},  // Off-white.
    buttonTouchedColor: {default: 'yellow'},  // Light blue.
    buttonPressedColor: {default: 'orange'},  // Light blue.
    model: {default: true},
    rotationOffset: {default: 0} // use -999 as sentinel value to auto-determine based on hand
  },

  // buttonId
  // 0 - trackpad
  mapping: {
    axis0: 'trackpad',
    axis1: 'trackpad',
    button0: 'trackpad',
    button1: 'menu',
    button2: 'system'
  },

  /**
   * Called once when component is attached. Generally for initial setup.
   */
  init: function () {
    this.controllerPresent = false;
    this.isControllerPresent = trackedControlsUtils.isControllerPresent; // to allow mock
    this.buttonStates = {};
    this.previousAxis = [];
    this.armModel = new OrientationArmModel();
    this.onModelLoaded = bind(this.onModelLoaded, this);
    this.checkIfControllerPresent = bind(this.checkIfControllerPresent, this);
    this.onGamepadConnected = bind(this.onGamepadConnected, this);
    this.onGamepadDisconnected = bind(this.onGamepadDisconnected, this);
  },

  tick: function (time, delta) {
    if (!this.controller) return;
    var mesh = this.el.getObject3D('mesh');
    // Update mesh animations.
    if (mesh && mesh.update) { mesh.update(delta / 1000); }
    this.updatePose();
    this.updateButtons();
  },

  /**
   * Called when entity resumes.
   * Use to continue or add any dynamic or background behavior such as events.
   */
  play: function () {
    this.checkIfControllerPresent();
    window.addEventListener('gamepadconnected', this.onGamepadConnected, false);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected, false);
  },

  /**
   * Called when entity pauses.
   * Use to stop or remove any dynamic or background behavior such as events.
   */
  pause: function () {
    window.removeEventListener('gamepadconnected', this.onGamepadConnected, false);
    window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected, false);
  },

  /**
   * Called when a component is removed (e.g., via removeAttribute).
   * Generally undoes all modifications to the entity.
   */
  // TODO ... remove: function () { },

  checkIfControllerPresent: function () {
    var isPresent = this.isControllerPresent(this.el.sceneEl, GAMEPAD_ID_PREFIX, {});
    if (isPresent === this.controllerPresent) { return; }
    this.controllerPresent = isPresent;
    if (isPresent) {
      this.el.addEventListener('model-loaded', this.onModelLoaded);
      this.controller = trackedControlsUtils.getGamepadsByPrefix(GAMEPAD_ID_PREFIX)[0];
      if (!this.data.model) { return; }
      this.el.setAttribute('obj-model', {
        obj: DAYDREAM_CONTROLLER_MODEL_OBJ_URL,
        mtl: DAYDREAM_CONTROLLER_MODEL_OBJ_MTL
      });
    } else {
      this.controller = null;
      this.el.removeAttribue('obj-model');
      this.el.removeEventListener('model-loaded', this.onModelLoaded);
    }
  },

  onGamepadConnected: function (evt) {
    this.checkIfControllerPresent();
  },

  onGamepadDisconnected: function (evt) {
    this.checkIfControllerPresent();
  },

  onModelLoaded: function (evt) {
    var controllerObject3D = evt.detail.model;
    var buttonMeshes;
    if (!this.data.model) { return; }
    buttonMeshes = this.buttonMeshes = {};
    buttonMeshes.menu = controllerObject3D.getObjectByName('menubutton');
    buttonMeshes.system = controllerObject3D.getObjectByName('systembutton');
    buttonMeshes.trackpad = controllerObject3D.getObjectByName('touchpad');
    // Offset pivot point
    controllerObject3D.position.set(0, -0.015, 0.04);
  },

  updateButtonModel: function (buttonName, state) {
    var color = this.data.buttonColor;
    if (state === 'touchstart' || state === 'up') {
      color = this.data.buttonTouchedColor;
    } else if (state === 'down') {
      color = this.data.buttonPressedColor;
    }
    var buttonMeshes = this.buttonMeshes;
    if (!buttonMeshes) { return; }
    buttonMeshes[buttonName].material.color.set(color);
  },

  updatePose: (function () {
    var controllerEuler = new THREE.Euler();
    var controllerQuaternion = new THREE.Quaternion();
    return function () {
      var controller = this.controller;
      var pose = controller.pose;
      var el = this.el;
      var camera = this.el.sceneEl.camera;
      var orientation;
      var armModelPose;
      if (!controller) { return; }
      // Feed camera and controller into the arm model.
      camera = this.el.sceneEl.camera;
      this.armModel.setHeadOrientation(camera.quaternion);
      this.armModel.setHeadPosition(camera.position);
      // feed the controller orientation into the arm model.
      orientation = pose.orientation || [0, 0, 0, 1];
      controllerQuaternion.fromArray(orientation);
      this.armModel.setControllerOrientation(controllerQuaternion);
      // Get resulting pose
      this.armModel.update();
      armModelPose = this.armModel.getPose();
      controllerEuler.setFromQuaternion(armModelPose.orientation);
      // update the rotation
      el.setAttribute('rotation', {
        x: THREE.Math.radToDeg(controllerEuler.x),
        y: THREE.Math.radToDeg(controllerEuler.y),
        z: THREE.Math.radToDeg(controllerEuler.z) + this.data.rotationOffset
      });
      // update the position
      el.setAttribute('position', {
        x: armModelPose.position.x,
        y: armModelPose.position.y,
        z: armModelPose.position.z
      });
    };
  })(),

  updateButtons: function () {
    if (!this.controller) { return; }
    this.handleTrackpadButton();
    this.handleTrackpadGestures();
  },

  handleTrackpadGestures: function () {
    var controllerAxes = this.controller.axes;
    var previousAxis = this.previousAxis;
    var changed = false;
    var i;
    for (i = 0; i < controllerAxes.length; ++i) {
      if (previousAxis[i] !== controllerAxes[i]) {
        changed = true;
        break;
      }
    }
    if (!changed) { return; }
    this.previousAxis = controllerAxes.slice();
    this.el.emit('axismove', {axis: this.previousAxis});
  },

  handleTrackpadButton: function () {
    // handle all button states
    var id = 0;
    var buttonState = this.controller.buttons[id];
    var changed = false;
    changed = changed || this.handlePress(id, buttonState);
    changed = changed || this.handleTrackpadTouch(id, buttonState);
    if (!changed) { return; }
    this.el.emit('buttonchanged', {id: id, state: buttonState});
  },

  handleMenuButton: function () {
    // TODO: implement when Gamepad API starts returning menu button state
  },

  handleSystemButton: function () {
    // TODO: implement when Gamepad API starts returning system button state
  },

  /**
  * Determine whether a button press has occured and emit events as appropriate.
  *
  * @param {string} id - id of the button to check.
  * @param {object} buttonState - state of the button to check.
  * @returns {boolean} true if button press state changed, false otherwise.
  */
  handlePress: function (id, buttonState) {
    var buttonStates = this.buttonStates;
    var evtName;
    var buttonName;
    var previousButtonState = buttonStates[id] = buttonStates[id] || {};
    if (buttonState.pressed === previousButtonState.pressed) { return false; }
    if (buttonState.pressed) {
      evtName = 'down';
    } else {
      evtName = 'up';
    }
    this.el.emit('button' + evtName, {id: id});
    buttonName = this.mapping['button' + id];
    this.updateButtonModel(buttonName, evtName);
    previousButtonState.pressed = buttonState.pressed;
    return true;
  },

  /**
  * Determine whether a button touch has occured and emit events as appropriate.
  *
  * @param {string} id - id of the button to check.
  * @param {object} buttonState - state of the button to check.
  * @returns {boolean} true if button touch state changed, false otherwise.
  */
  handleTrackpadTouch: function (id, buttonState) {
    var buttonStates = this.buttonStates;
    var evtName;
    var buttonName;
    var previousButtonState = buttonStates[id] = buttonStates[id] || {};
    if (buttonState.touched === previousButtonState.touched) { return false; }
    if (buttonState.touched) {
      evtName = 'start';
    } else {
      evtName = 'end';
    }
    previousButtonState.touched = buttonState.touched;
    this.el.emit('touch' + evtName, {
      id: id,
      state: previousButtonState,
      axis: this.controller.axes
    });
    buttonName = this.mapping['button' + id];
    this.updateButtonModel(buttonName, 'touch' + evtName);
    return true;
  }
});
