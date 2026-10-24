// Only internal application destinations survive a login/registration round trip.
export const authDestination = requested => typeof requested === 'string' && requested.startsWith('/app/') &&
  !/^\/app\/(?:login|register)(?:[/?#]|$)/.test(requested) && !requested.includes('\\') &&
  !Array.from(requested).some(character => character.charCodeAt(0) <= 32) ? requested : '/';
