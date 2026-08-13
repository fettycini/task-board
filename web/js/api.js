/* Tiny fetch wrapper. Plain scripts, no bundler — the Pi should not need a
   build step to show a chore list. Everything hangs off one global. */
window.TB = window.TB || {};

TB.api = (function () {
  'use strict';

  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (_) {
      // Server restarting or not up yet.
      throw new Error("Can't reach the board");
    }

    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {
      /* empty body is fine */
    }

    if (!res.ok) throw new Error((payload && payload.error) || `Request failed (${res.status})`);
    return payload;
  }

  return {
    getBoard: (weekKey) =>
      request('GET', '/api/board' + (weekKey ? `?week=${encodeURIComponent(weekKey)}` : '')),

    addTask: (task) => request('POST', '/api/tasks', task),
    updateTask: (id, patch) => request('PATCH', `/api/tasks/${id}`, patch),
    deleteTask: (id) => request('DELETE', `/api/tasks/${id}`),
    resetWeek: (weekKey) => request('POST', '/api/week/reset', { weekKey }),

    addTemplate: (tpl) => request('POST', '/api/templates', tpl),
    updateTemplate: (id, patch) => request('PATCH', `/api/templates/${id}`, patch),
    deleteTemplate: (id) => request('DELETE', `/api/templates/${id}`),

    addShopping: (item) => request('POST', '/api/shopping', item),
    updateShopping: (id, patch) => request('PATCH', `/api/shopping/${id}`, patch),
    deleteShopping: (id) => request('DELETE', `/api/shopping/${id}`),
    clearCheckedShopping: () => request('POST', '/api/shopping/clear', {}),

    updateSettings: (patch) => request('PATCH', '/api/settings', patch),
    resetPalette: (key) => request('POST', `/api/palettes/${key}/reset`, {}),

    addPerson: (person) => request('POST', '/api/people', person),
    updatePerson: (id, patch) => request('PATCH', `/api/people/${id}`, patch),
    // reassignTo: a person id, 'shared', or null to delete their work too.
    deletePerson: (id, reassignTo) => request('DELETE', `/api/people/${id}`, { reassignTo: reassignTo || null }),
    reorderPeople: (order) => request('POST', '/api/people/reorder', { order }),

    resetAll: (options) => request('POST', '/api/reset', options || {}),
  };
})();
