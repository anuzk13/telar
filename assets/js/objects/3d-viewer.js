/**
 * 3D object viewer using three.js PerspectiveCamera GLTFLoader and OrbitControls.
 * 
 * https://github.com/mrdoob/three.js/blob/master/examples/webgl_camera.html
 * https://github.com/mrdoob/three.js/blob/master/examples/webgl_loader_gltf.html
 * 
 */

(function () {

  const THREE = window.THREE;
  const OrbitControls = window.OrbitControls;
  const GLTFLoader = window.GLTFLoader;

  let container, errorContainer, loadingContainer;
  let camera, scene, renderer, controls;

  const CAMERA_FOV = 45;
  const CAMERA_NEAR = 0.01;
  const CAMERA_FAR = 1000;

  init();

  function init() {

    container = document.getElementById('object-viewer');
    errorContainer = document.getElementById('model-error');
    errorContainer.style.display = 'none';

    loadingContainer = document.getElementById('model-loading');
    loadingContainer.style.display = 'block';

    const modelUrl = container.dataset.modelUrl;

    const aspect = container.clientWidth / container.clientHeight;
    camera = new THREE.PerspectiveCamera( CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR );

    scene = new THREE.Scene();
    
    initLights();
    loadModel(modelUrl);

    renderer = new THREE.WebGLRenderer( { antialias: true, alpha: true } );
    renderer.setClearAlpha(0);
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( container.clientWidth, container.clientHeight );
    renderer.setAnimationLoop( render );
    renderer.toneMapping = THREE.NeutralToneMapping;
    container.appendChild( renderer.domElement );

    controls = new OrbitControls( camera, renderer.domElement );
    controls.enableDamping = true;

    window.addEventListener( 'resize', onWindowResize );

  }

  // https://github.com/mrdoob/three.js/blob/master/examples/webgl_lights_hemisphere.html
  function initLights() {
    const hemiLight = new THREE.HemisphereLight( 0xffffff, 0xbbbbbb, 1.2 );
    hemiLight.position.set( 0, 50, 0 );
    scene.add( hemiLight );

    const dirLight = new THREE.DirectionalLight( 0xffffff, 2.0 );
    dirLight.position.set( - 1, 1.75, 1 );
    dirLight.position.multiplyScalar( 30 );
    scene.add( dirLight );

    dirLight.castShadow = false;
  }

  function loadModel (modelUrl) {
    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      async function (gltf) {
        loadingContainer.style.display = 'none';
        // wait until the model can be added to the scene without blocking due to shader compilation
				await renderer.compileAsync( gltf.scene, camera, scene );
        scene.add(gltf.scene);
        fitCameraToModel ( camera, gltf.scene );
      },
      function () {
        loadingContainer.style.display = 'block';
      },
      function (err) {
        errorContainer.style.display = 'block';
        loadingContainer.style.display = 'none';
      }
    );

  }

  function fitCameraToModel ( camera, model ) {
    const box = new THREE.Box3();
    box.setFromObject( model );
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const distance = getDistanceToFitSphere(sphere.radius);
    const c = sphere.center;
    camera.position.set(c.x, c.y, c.z + distance); 
    camera.updateProjectionMatrix();
    controls.target.copy(c);
    controls.minDistance = sphere.radius * 0.2;
    controls.maxDistance = distance + sphere.radius * 4;
    controls.update();
  }

  /**
   * What distance should the camera be to frame the sphere along thhe smallest dimension of the viewport?
   *
   * adapted from https://github.com/yomotsu/camera-controls/blob/dev/src/CameraControls.ts#L2447.
   */
  function getDistanceToFitSphere(radius){
		// https://stackoverflow.com/a/44849975
		const vFOV = camera.getEffectiveFOV() * Math.PI / 180;
		const hFOV = Math.atan( Math.tan( vFOV * 0.5 ) * camera.aspect ) * 2;
		const fov = 1 < camera.aspect ? vFOV : hFOV;
		return radius / ( Math.sin( fov * 0.5 ) );
	}

  function onWindowResize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( container.clientWidth, container.clientHeight );
    render();
  }

  function render() {
    controls.update();
    renderer.render( scene, camera );
  }

  
})();
