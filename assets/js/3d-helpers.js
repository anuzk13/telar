/**
 * Shared three.js helpers
 */

/**
 * What distance should the camera be to frame the sphere along thhe smallest dimension of the viewport?
 *
 * adapted from https://github.com/yomotsu/camera-controls/blob/dev/src/CameraControls.ts#L2447.
 */
export function getDistanceToFitSphere(camera, radius) {
  // https://stackoverflow.com/a/44849975
  const vFOV = camera.getEffectiveFOV() * Math.PI / 180;
  const hFOV = Math.atan(Math.tan(vFOV * 0.5) * camera.aspect) * 2;
  const fov = 1 < camera.aspect ? vFOV : hFOV;
  return radius / Math.sin(fov * 0.5);
}

export function fitCameraToModel(camera, controls, model) {
  const THREE = window.THREE;
  const box = new THREE.Box3();
  box.setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const distance = getDistanceToFitSphere(camera, sphere.radius);
  const c = sphere.center;
  camera.position.set(c.x, c.y, c.z + distance);
  camera.updateProjectionMatrix();
  controls.target.copy(c);
  controls.minDistance = sphere.radius * 0.2;
  controls.maxDistance = distance + sphere.radius * 4;
  controls.update();
}

export function readCameraSpherical(camera, target) {
  const THREE = window.THREE;
  const offset = camera.position.clone().sub(target);
  const s = new THREE.Spherical().setFromVector3(offset);
  return {
    azimuth: s.theta * 180 / Math.PI,
    elevation: s.phi * 180 / Math.PI,
    distance: s.radius,
  };
}

export function applyCameraSpherical(camera, controls, pose) {
  const THREE = window.THREE;
  const s = new THREE.Spherical(
    pose.distance,
    pose.elevation * Math.PI / 180,
    pose.azimuth * Math.PI / 180
  );
  const offset = new THREE.Vector3().setFromSpherical(s);
  if (pose.target) controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
  camera.position.copy(controls.target).add(offset);
  camera.updateProjectionMatrix();
  controls.update();
}

export function setupNeutralEnvironment(renderer, scene) {
  const THREE = window.THREE;
  const RoomEnvironment = window.RoomEnvironment;
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment()).texture;
  pmremGenerator.dispose();
}
