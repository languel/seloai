/**
 * Player mode: SeloAI opened by an exported performance (`?player`), to play it. It loads the
 * performance's world and script from the page around it and never saves anything, so watching
 * a performance cannot touch a viewer's own worlds or settings.
 */
export const PLAYER_MODE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('player');
