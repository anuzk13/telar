### 3D refactoring reflections

- I decided to do a partial refactor that would support the model object in the object and story page views. These are the results and conclusions for the refactor
- Results
	- My refactor is partial and breaks many things. My idea was to try to keep some core functionality working in a way that I thought the files were more legible
		- All non-3d object viewiewer and story types are broken
		- I did not touch the tests
		- In my refactor all the logic of mobile breaks because the navigation logic for mobile without scroll is still spread out to navigation.js and deeplink.js.
			- I was trying to push a change to fix this but did not have time
		- The 3D code for model-viewer had a nicer rotation model with a shortest path algorithm, this could be added to the threejs implementation
	- I changed model-viewer for threejs
		- the old code was trying to force model-viewer to scroll manually, but model-viewer is designed to transition automatically, a lot of the code is modifying that behavior
		- threejs lets us shift the camera transform matrix with an offset so a model can exist behind the cards, it also lets us manually define what a "centered" object means, this is important since users are storing their positions relative to this (orbit zoom). We define the object centered in a bounding sphere that we construct from a bounding box 
	- I separated the object view into its own file
		- Right now all the code for object views is embedded in the template of object.html this makes the code hard to read and test. A lot of the code between objects is repeated, I think it should be put in different modules and includes that manage the shared UI across objects instead of it being copied for every object.
		- I created a module for the 3d object viewer
		- I created a view specific for the 3d object viewer that has the navigation specific to this object and the 3d rendering
		- there are threejs helpers that are shared  with the story modules that also use threejs
	- I re-structured the card-pool and the panels for 3D models
		- card-pool is now the only responsible for the logic of orchestrating cards and panels, and making sure panels preload views. 
			- before, the card-pool logic was spread across scroll and navigation, and the card-pool tried to do too much for each object-type panel
			- I separated the logic for a panel into its own file, so each panel manages how the show instead of card-pool trying to manage it all. 
				- The panel has an interface and each object-type panel extends it. I just implemented the model panel which manages just the rendering and animation of the 3d models
			- I also separated the text-cards into their own module so each text card manages the animation 
		- this refactor fixed some bugs
			- The deep links seem to be broken at least for images and 3d models they change very slowly/fast with the scroll
			- When you click "black-to start" the cards remain stuck 
	- I refactored general code elements
		- some variables are not clearly named, ids should be specified as so: sceneId, elements like cardStackElem, etc. 
		- there is a lot of defensive programming and null checks for things that cannot be null unless the code itself is wrong. This may be my opinion but LLMs produce very defensive code (checking for nulls all the time and adding ? and defaults) that I think make the code harder to read and can introduce bugs
		-  AI adds many self-reflective comments (i.e explaining why changes are made but these dont make sense when read for the first time)
		- AI tends to add a lot of metaphors to the code to explain what is doing, but the metaphors change across the code and for each function and this makes it incosistent.
		- AI tries to keep code compatible with previous versions of code even if not explicitly asked to do so.
			- Backwards compatibility, if important for telar, would be better as an explicit rule. AI confounds trying to keep the code of a previous prompt working with backwards compatibility

### Big architecture improvements
- Decide if file:// is important if it is:
	- remove the fetch requests and show error messages for the object types that are not supported because they require fetch  by default (3d objects and potentially audio), and find a way to load manifests without fetch.
	- if it is not
		- use dynamic modules
- use modules more consistently across the code, some are IIFE functions some are modules.
- If ruby is removed:
	- if node is used to run telar scripts then use it for templating as well.
- This is my personal experience but using typescript helps also control the way LLMs write web code and its easier to understand the code because types help understand what variables are.
### Possible improvements in current code
- localization
	- Since the localization is managed with jekyll and ruby, the pages that are not generated (i.e the story) do not have localization
		- the error for the model load is only in english for example
- `_includes`
	- viewer.html is not used? what is it?
- processing scripts + templates + cardpool (injecting file type metadata)
	- `_filePathFor` in card-pool.js should just use metadata from the files 
	- I think object type and extension should be added as metadata
		- I think the audio and 3D models (and audio) should include the extension as metadata
			- temp fix
				- I am using model_objects to get the extension like card-pool does, but I think this has to be refactored so that the metadata itsef includes the file extension
			- issue
				- right now the approach is to test for multiple types of files to see if one is included? I am not sure why (this happens in object.html)
				- this approach is also different for 3d where it tries for glb and then goes for gltf
				- the extension is already available as metadata but used in a weird way in telar story in a file that maps all the ids to json
					- in the card-pool the audio and model files are desambiguated if they have this file
					- this file is also used to know the extension of an object in the cardpool
					- This is also not necessary because the media_type (image, audio, model) IS available on the metadata so that file just needs to read that, it does not need to check if the files with the extensions exist Intuitive 3D snapshots
- processing scripts
	- csv col name management
		- the translations are used to both translate and also for backwards compatibility of row names, those should not be combined, should be separate string maps
		- also probably in general all translation strings should be on the same folder and imported
	- I realized there is an error when I copy the fields form the image preview the order is wrong
-  scripts/telar/processors/objects.py
	- I think object types (object.media_type) should be a constant
	- `valid_extensions` is re-defined on multiple methods -- `_find_similar_image_filenames`, and `process_objects`
	- in `process_objects` is missing audio extensions in the `valid_extensions` array that removes the extension from the file to check it matches the csv
	- it would be better to separate the processing into different methods and use a switch case for readibility
	- If types are already defined in constants `_3D_EXTENSIONS` why redefine it again? use the same arrays
	- the message error when no local file is found is overritten for audio, missing translation
- scripts/generate_collections.py
	- In generate collections there is a known_objects array but these attributes are already checked manually for different types of metadata (there is a dict that specifies how to handle standard attributes and then specific logic for audio and other metadata), this creates a redundancy to have to declare these things twice
		- temp fix
			- added the alt_text to the known objects and specified how it should be processed in the metadata_fields object
				- https://github.com/anuzk13/telar/commit/e025d30c33cfdb8df4aa4d3af323201c9277932f
		- issue
			- i.e there is a bug where alt_text is never included for any object because it has to be both in KNOWN_OBJECTS and the metadata_fields object
	- Methods and constants are repeated between objects.py and generate_collections.py
		- **this was fixed**
- build target iife and modules
	- The file:// protocol access it's broken right now
		- Also discuss wether it makes sense to keep UMD as the build target.
		- There are some principles of minimal computing but in terms of software there are contradictions
			- it requires python AND ruby. It could use only python
			- If it already uses python, then it could also run a small server so that it works on the USB approach
			- incompatibility with file://
				- some elements like fetching the manifest make it so that the file:// protocol won't work anyways
				- any binary file loaded like 3D data that does not have a standard html tag wont work 
					- The manifests can probably be written to the bundle or added as script tags?
				- wavesurfer also makes requests 
					- audio in theory can be loaded as an `<audio>` tag
				- threejs also loads glb files with fetch
				- Some files already import modules, libraries are inconsistently imported as injected scripts or modules (i.e audio) 

- number of tools/libraries
	- I am a bit curious about the use of ruby just of jekyll
		- Just python would allow to share constants in processing and templating (i.e media type)
		- Since python orchestrates everything the jekyll part could be replaced with jinja templates
		- if there is already a templating language and the idea is to create plain html files, why not create the cards and load the necessary scripts using the templating language instead of javascript? 


### Already started refactor (just for story with 3D models)
- object-index template
	- The whole code for the objects cards is repeated which can cause bugs, move it to another template and use {includes}
- object styles and templates 
	- the 3d navigator style is "burned" from the theme (the red, may not work with other themes)
	- the "coordinate" picker (dynamic styling / collapsing appearing) could be a component abstracted away. Also for simplicity why not leave it open all the time? and is the custom theme needed? it could be a simpler component
	- the function to define the styles based on the theme (dark or light) are copied for each object type, and it seems like a very specific thing that could be resolved more broadly for the whole "theme", some parts of the UI are dynamic while others are not. i would just simplify the way this panel works
	- separate the object viewer templates from the object template.
		- I am also creating a per-object stylesheet 
	- `_viewer`
		- maybe group classes according to object type?, each object could have their own scss since they are fairly different, I am also proposing a different layout per object_viewer
		- I think LLMs tend to leave a lot of comments about changes that are transient in files, then these comments just bloat the file itself. i.e
			- ```
			   * Styles for the IIIF image viewer embedded in story and object pages.
				 * v1.4.0 swapped the Tify dependency for a thin OpenSeadragon wrapper
				 * (assets/js/telar-story/iiif-viewer.js) that ships no chrome of its
				 * own, so this file no longer fights a Vue UI with `!important` —
				 * selector-based specificity is enough.
			  ```
- card-pool.js
	- There are three different files that import activateCard and have some custom logic for navigating: scroll egine, deep link and navigation. Scroll engine also manages navigation with keyboard arrows. Have not looked at this code but it looks like some spread logic, across multiple files and they dont manage unique responsibilities (i.e card transform css is managed in scroll )
		- -- this is partially fixed in my refactor, but I only separated the responabilities for card-pool, card-pool generator, navigation, and scroll may still have some issues. i.e 
		- navigation manages some thing about mobile that card-pool should do, so maybe my refactor broke this
	- arial labels are English only
		- `_buildAriaLabel` uses english only in cardpool
	- sources of extensions -- this code is overriden by my refactor
		- `card-pool.js` has two sources for the extensions the storyData and the window.[audio/model]Object. sotyData never has these objects and is confusing why is it used as the first source
			- In general I think the extensions should just be part of the metadata of each object and not this separate map
			- temp fix
				- Just remove the objects that are never initialzed and use the window properties
					- https://github.com/anuzk13/telar/commit/1b9c8f5cd813a60148849ded18242ec37214cf40
	- activating plates -- this code is overriden by my refactor
		- `activateCard` calls `_activateNewViewerPlate(...)` only in the forward direction but not in the backward direction. The code in `_activateNewViewerPlate(...)` for the backward direction is never used
	- destroying -- this code is overriden by my refactor
		- it is not consistent how the viewers are destroyed, some logic is managed by the card-pool (images), other the viewers are destroyed by the [object-type]card.js which has the active viewers and removes them if they go above the count
			- is also strange because the card-pool has the specific logic of which cards need to be preloaded so it can remove the other ones as they are not needed, and the deep link is a fresh browser so the viewers should be a clean slate, so should it be not the card-pool the one creating AND destroying the pre-fetched viewers if it wants things to be smooth? how does the model-card know which ones to remove can't it just end up undoing the pre-fetch task of the card-pool?
