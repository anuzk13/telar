- Looking at the 1.7 commits
	- split the card-pool functions commit
		-  goToStep and the mobile intro restore in navigation.js are split along their seams, behaviour unchanged
			- what does it mean "split along their seams"? is there a way to keep commits technical, informative summaries 
		- not part of the "cleaning" commit but looking at card-pool code in general
			- export function _buildSceneMaps(steps) why is it exported if its private and re-exported later for testing anyways?
			- why does the state replicate the card data? there are two data structures that have the same information and used in different methods -- state.cardRegistry, state.textCards...I don't think they are justified for efficiency in access to the information and methods use them inconsistently. 
			- Some things in `_createTextCards` are dead code because they are immediately and unconditionally followed by `_recomputeCardGeometry` which changes them
				- computeCardTop(viewportH, cardH, 0, peekHeight), card.style.top = ..., card.style.height = ${cardH}px,.. and all the variables that are used for those 
			- The term "peek" is really hard to understand what the code is doing with the cards and why it needed the runPos (the position within a scene of a card, maybe scenePos would be better?) so its to calculate a top offset, but peek is not clear
			- The `detectCardType` pattern is also in this script, the approach of testing urls to know what a file is, I wonder why the code is this way? it starts from mapping an object to a type because users are not required to declare the file type on the excel sheet, but since that is figured out since the python step somehow the data is lost and js has to write it again
				- Also the cardpool for the plates stores this value once: ` plate.dataset.cardType = sceneCardType;` but uses it just for a few things later, and other times it uses a class name plate.classList i.e `plate.classList.contains('video-plate')` to init the video_plate viewer
				- `plate.dataset.cardType = cardType;` is assigned twice (in the plate init and in `_markMediaPlate`)
				- There is also state.cardRegistry.cardType that is never read
				- All this matters because is really hard to understand what is the data structure / where is data coming for rendering things..usually I would look at init stages to see what the program starts with to know what to do but if the data is used differently and is redundant is hard to know
			- Not clear what the "hidden step" is from the comment and maybe has to do with encryption? maybe something more simple like copy pre-rendered html content or render it if not existing for encrypted content
			- `activateCard` is the most important function in cardpool since other navigation modules call it but has no documentation
		- The limitations of a "complexity approach" 
			- This function was separated:
					```
					function _detectStepCardType(objectId, step, audioObjects) {
					  const objectData = state.objectsIndex[objectId] || {};
					  const audioExt = audioObjects[objectId];
					  return detectCardType({
					    objectId,
					    cardType: step.cardType,
					    source_url: objectData.source_url || objectData.iiif_manifest || '',
					    file_path: audioExt ? `objects/${objectId}.${audioExt}` : '',
					  });
				}
					```
			- Is called in two places:
				- when the object scene card is created
				- when the text card is created
				- But the text card does not need that information, it's stored in the state but not used anywhere 
				- So the card-pool state is tracking things that are not used for anything in the logic
		- Something claude does, I feel is using weird "fallbacks"...why is the default page 10? should this just be an error? 
			```
			/**
				 * The framing a step asks its viewer for.
				 *
				 * x, y and zoom are NaN when the step leaves them blank, which every caller
				 * reads as "no authored position"; page is 1-indexed in the story data and
				 * absent unless the object is a multi-page external manifest.
				 *
				 * @param {Object} step - Step data
				 * @returns {{ x: number, y: number, zoom: number, page: number|undefined }}
				 */
				function _stepFraming(step) {
				  return {
				    x:    parseFloat(step.x),
				    y:    parseFloat(step.y),
				    zoom: parseFloat(step.zoom),
				    page: step.page ? parseInt(step.page, 10) : undefined,
				  };
				}
			```
		- Some weird phrasing / formatting 
			-  There is a pretty large comment that starts "Activate the card at the given step index, orchestrating context-sensitive  stacking based on whether the object changed." but no function after it?
			- A comment says "The second is much the commoner case and much the cheaper one, which is why the two are distinguished at all."
			- two different comments for `_swapPlatesBackward`, it says the same thing in different ways, I think its responding to one of my previous revisions
			- Also repeated comment for `_interpolatePlateHandoff`
		- I read carefully until the andvance forward / backward methods, so these comments are more general
			- I think the architecture of the card-pool still does not separate too well between the different types of objects, but maybe I am just too fixated on this because I was adding a new object type
				- preloadAhead calls warmup which checks for the scene object type but it also preloads the urls for the images that are remote by default, I think the warmup should be better compartmentalized per object 
				- the ifs for each object type is something i commented on the jekyll object pages that I wanted to separate more on my 3d refactor, if more objects are added more ifs are added.
				- The caardpool should have just a clear responsability of orchestrating the cards and triggering activations and de-activations but the logic of each of those could be separate modules for each obejct type. I think there is too much coupling between each object type and the cardpool 
					- I had done that in this commit for example: https://github.com/anuzk13/telar/commit/016462ba02bd6dde846bf0ac0086c8682e647b64 
				- `_wireViewerForPlate` also has ifs for each object type that could not scale too well
				- I think in general if I were to add the 3D module here I still would need some chatbot assistance because it's not clear yet all the places I would have to change (ifs) to add a new media type
			- 
	- new [object javascript]([https://gitkraken.dev/link/Z2l0a3Jha2VuOi8vcmVwb2xpbmsvY2E4M2ZlNzVkNmI3M2FiNDgyNGE2ODY1ODJiNzVlMWU4YWI1OGQzZS9jb21taXQvMDA2NTdhY2E5ZmM0NTFmMDAxMDM1MGZmMmYzNzQ3ZDM0MWJlYjNkYj91cmw9aHR0cHMlM0ElMkYlMkZnaXRodWIuY29tJTJGVUNTQi1BTVBMYWIlMkZ0ZWxhci5naXQ%3D?origin=gitkraken](https://github.com/anuzk13/telar/commit/00657aca9fc451f0010350ff2f3747d341beb3db))
		- I think this makes the code much clearer already
		- maybe for commits is better to describe what was changed:
			- The original commit is confusing, is hard to know what was changed to achieve what is described
				- The layout writes one JSON block and loads object-page.js, bundled from assets/js/object-page/. The viewer wrapper is imported and bundled rather than fetched as a bare module. Single-page objects copy coordinates without a page number
			- A small summary lets the reader quickly identify what the changes introduced
				- Move data from the template to a JSON file that is loaded in the template
				- Move scripts from the template into a bundled script ( object-page.js)
				- Viewer is now bundled with  object-page.js
				- Add functionality to copy coordinates without a page number
		- I had flagged the function to guess the extension of an object based on queries to the server before, I think since the file type is detected on the python processing it could be added to the metadata instead of sending queries to the server for multiple files
			- i.e in this [commit](68337bd03aba348376cc1568c972d6bec5dcc068)
		```
		
	/** The first of the candidate audio URLs the server answers for, or null. */
	export async function findAudioUrl(baseUrl, objectId, fetchFn = fetch) {
	  for (const ext of EXTENSIONS) {
	    const testUrl = baseUrl + '/telar-content/objects/' + objectId + ext;
	    try {
	      const resp = await fetchFn(testUrl, { method: 'HEAD' });
	      if (resp.ok) return testUrl;
	    } catch (e) { /* continue */ }
	  }
	  return null;
	}
		```
		- IMO the object templates could be simplified by separating one template per object
			- i.e in this [commit](https://gitkraken.dev/link/Z2l0a3Jha2VuOi8vcmVwb2xpbmsvY2E4M2ZlNzVkNmI3M2FiNDgyNGE2ODY1ODJiNzVlMWU4YWI1OGQzZS9jb21taXQvMmUyNDliZDJhZTBiZWM2MjA2Zjc0NjNhYmUzNzY4YWVhYjQ2OTA4Zj91cmw9aHR0cHMlM0ElMkYlMkZnaXRodWIuY29tJTJGYW51emsxMyUyRnRlbGFyLmdpdA%3D%3D?origin=gitkraken) 
			- this way each object viewer, coordinate picker and specific libraries can be loaded just for a single object. 
	- iiff generation [commit](https://gitkraken.dev/link/Z2l0a3Jha2VuOi8vcmVwb2xpbmsvY2E4M2ZlNzVkNmI3M2FiNDgyNGE2ODY1ODJiNzVlMWU4YWI1OGQzZS9jb21taXQvYzI1Njc5YTljMDE1NjQ2YmRiNDA3MWIxMTMyYmMwODA0OGI5YWYxYT91cmw9aHR0cHMlM0ElMkYlMkZnaXRodWIuY29tJTJGVUNTQi1BTVBMYWIlMkZ0ZWxhci5naXQ%3D?origin=gitkraken)
		- ![[Pasted image 20260914164502.png]]
		- I think the file type management may be something to look into? 
		- The two extension lists don't agree: csv_utils vs generate_iiif
	- encryption [commit](https://gitkraken.dev/link/Z2l0a3Jha2VuOi8vcmVwb2xpbmsvY2E4M2ZlNzVkNmI3M2FiNDgyNGE2ODY1ODJiNzVlMWU4YWI1OGQzZS9jb21taXQvYmNmMDdhNTNjNTUxMTc1Yzc0Njk0MGJmOTBkYTE3Yzk2YjA5M2EyMz91cmw9aHR0cHMlM0ElMkYlMkZnaXRodWIuY29tJTJGVUNTQi1BTVBMYWIlMkZ0ZWxhci5naXQ%3D?origin=gitkraken) 
		- Looks like the AI conversation with the issues is still present in the comments. 
			- i.e this comment is in the middle of the process to generate collections but has references to a bug that was fixed, I think this just makes the code patchy, and the reader has to understand the broader context, which can be done but make less like "do this, except this because then this happened"  and instead should be "do this, this and this". Things like it may clean... when? why? why is that comment there?
```
		    # After generate_pages: it may clean _jekyll-files/_pages/, where the
		    # fragment pages live
		    # Always called: even when stories are skipped, a fragment page left
		    # from an earlier run must be cleared, or it renders plaintext steps that
		    # nothing will encrypt. The function returns after that cleanup when
		    # there is nothing to generate.
		    generate_protected_fragments(skip=skip_stories)
```
