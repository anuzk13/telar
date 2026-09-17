## Initial Idea

- Refactor telar to help with existing architecture issues in the frontend
- 1. Refactor existing js into typescript to have a better front end architecture
    - I think this could be done so that the ts exports modules that are imported on each page
    - We are sacrificing some of the licensing MIT vs apache because of typescript
        - what does this entail?
    - Migration to typescript by modules
        1. story module: refactor assets/js/telar-story to create a js library from typescript that takes as input the steps metadata and config information and creates the scrolling view of a telar
            - What are the main features to mantain? 
                - transform telar steps into a different data structure: scene, which are consecutive steps for the same object
                - support different object types: iiif images, audio files, video files, pdf files
                - support different forms of navigation: scroll, keyboard navigation, button navigation on mobile 
                - support story-fragments - template generated html from markdown
                    - support latex rendering inside the mardoen generated content
                    - support widgets - template generated html? - used to show carousel, tabs, accordion, bibliography
                - support encrypted data for story-fragments
            - What is changing?
                - change the way the scroll works without stacking cards and instead cards that scroll by 
            - Is it worth it to keep iife as a compile target for the js bundle?
                - iife is a legacy module formats, es modules is more modern and can allow dynamic imports which are right now done with vanilla js
                - I think it was originally added for compatibility with the file protocol, but the fetch function is not compatible with that protocol anyways 
                - This allows us to dynamically loads scripts just using import without custom code
            - Should we move vendor to npm modules? are there any we cannot vendor? 
            - What is the data structure that the static page story.html needs to pass to the script?
                - is any structure provided on the html itself or is it all json?
        2. continue moving other modules to typescript
            - object -  the scrips to preview a single object and get the coordinates / timesteps for different types of objects
            - home
            - objects-index
            - iiif-url
            - objects-filter
            - share-panel
            - Extra scripts, what moduel are they part of? 
                - object theme
                - iiif thumbnails
                - iiif warnings
                - embed
                - story-unlock
2. change the templating language
    - moving away from ruby into an already existing platform would be an advantage
        - python -- jinja, pelican
        - javascript -- 11ty, astro, svelte
    - juan uses Hugo but this would be another programming language to install / setup so maybe only if it has some uniquely good feature?
    - Questions: 
        - which of this would support the features that jekyll arelady support?
        - what are the licensing of these frameworks? 
           