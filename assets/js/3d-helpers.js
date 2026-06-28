/**
 * Shared three.js helpers
 */

/**
 * What distance should the camera be to frame the sphere along thhe smallest dimension of the viewport?
 *
 * adapted from https://github.com/yomotsu/camera-controls/blob/dev/src/CameraControls.ts#L2447.
 */
export function createRenderer(container) {
  const THREE = window.THREE;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);
  return renderer;
}

export function getDistanceToFitSphere(camera, radius) {
  // https://stackoverflow.com/a/44849975
  const vFOV = camera.getEffectiveFOV() * Math.PI / 180;
  const hFOV = Math.atan(Math.tan(vFOV * 0.5) * camera.aspect) * 2;
  const fov = 1 < camera.aspect ? vFOV : hFOV;
  return radius / Math.sin(fov * 0.5);
}

export function fitCameraToModel(camera, model) {
  const THREE = window.THREE;
  const box = new THREE.Box3();
  box.setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const distance = getDistanceToFitSphere(camera, sphere.radius);
  const c = sphere.center;
  camera.position.set(c.x, c.y, c.z + distance);
  camera.lookAt(c);
  return { target: [c.x, c.y, c.z], distance, radius: sphere.radius };
}

export function setupNeutralEnvironment(renderer, scene) {
  const THREE = window.THREE;
  const RoomEnvironment = window.RoomEnvironment;
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment()).texture;
  pmremGenerator.dispose();
}
