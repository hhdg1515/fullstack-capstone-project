// Empty in a same-origin production deployment; development may use one exact API origin.
const config = { backendUrl: process.env.REACT_APP_BACKEND_URL || '' };
export { config as urlConfig };
