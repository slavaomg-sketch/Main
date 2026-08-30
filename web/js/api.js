/* Тонкий клиент к API панели. */
(function (global) {
  'use strict';

  function request(method, path, body) {
    var options = {
      method: method,
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(path, options).then(function (response) {
      if (response.status === 401) {
        var unauthorized = new Error('Требуется вход');
        unauthorized.status = 401;
        throw unauthorized;
      }
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) {
          var error = new Error(payload.detail || ('Ошибка ' + response.status));
          error.status = response.status;
          throw error;
        }
        return payload;
      });
    });
  }

  function query(params) {
    var parts = [];
    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  global.Api = {
    session: function () { return request('GET', '/api/session'); },
    health: function () { return request('GET', '/api/health'); },
    login: function (password) { return request('POST', '/api/auth/login', { password: password }); },
    logout: function () { return request('POST', '/api/auth/logout'); },

    overview: function (params) { return request('GET', '/api/overview' + query(params)); },
    marketplaces: function () { return request('GET', '/api/marketplaces'); },
    clearCache: function () { return request('POST', '/api/cache/clear'); },
    syncStatus: function () { return request('GET', '/api/sync'); },
    sync: function () { return request('POST', '/api/sync'); },

    connections: function () { return request('GET', '/api/connections'); },
    addConnection: function (marketplace, title) {
      return request('POST', '/api/connections', { marketplace: marketplace, title: title });
    },
    updateConnection: function (id, patch) {
      return request('PUT', '/api/connections/' + encodeURIComponent(id), patch);
    },
    deleteConnection: function (id) {
      return request('DELETE', '/api/connections/' + encodeURIComponent(id));
    },
    testConnection: function (id) {
      return request('POST', '/api/connections/' + encodeURIComponent(id) + '/test');
    },

    inbox: function () { return request('GET', '/api/inbox'); },
    tasks: function () { return request('GET', '/api/tasks'); },
    knowledge: function () { return request('GET', '/api/knowledge'); },
    refreshKnowledge: function () { return request('POST', '/api/knowledge/refresh'); },
    knowledgeRefreshStatus: function () { return request('GET', '/api/knowledge/refresh'); },
    saveKnowledge: function (parent, title, facts) {
      return request('PUT', '/api/knowledge/' + encodeURIComponent(parent),
                     { title: title, facts: facts });
    },
    task: function (accountId, key, offset) {
      return request('GET', '/api/tasks/' + encodeURIComponent(accountId) +
                     '/' + encodeURIComponent(key) + query({ offset: offset }));
    },
    draftInbox: function (accountId, kind, id) {
      return request('POST', '/api/inbox/draft',
                     { accountId: accountId, kind: kind, id: id });
    },
    startBatch: function (accountId, kind, ids) {
      return request('POST', '/api/inbox/batch',
                     { accountId: accountId, kind: kind, ids: ids });
    },
    readBatch: function (id) {
      return request('GET', '/api/inbox/batch/' + encodeURIComponent(id));
    },
    sendBatch: function (accountId, kind, answers) {
      return request('POST', '/api/inbox/send',
                     { accountId: accountId, kind: kind, answers: answers });
    },
    answerInbox: function (accountId, kind, id, text) {
      return request('POST', '/api/inbox/answer',
                     { accountId: accountId, kind: kind, id: id, text: text });
    },

    blocks: function () { return request('GET', '/api/blocks'); },
    newBlock: function (type, size) {
      return request('POST', '/api/blocks/instance', { type: type, size: size });
    },

    layouts: function () { return request('GET', '/api/layouts'); },
    saveLayout: function (name, blocks) {
      return request('PUT', '/api/layouts/' + encodeURIComponent(name), { blocks: blocks });
    },
    deleteLayout: function (name) {
      return request('DELETE', '/api/layouts/' + encodeURIComponent(name));
    },
    renameLayout: function (name, next) {
      return request('POST', '/api/layouts/' + encodeURIComponent(name) + '/rename', { name: next });
    },
    resetLayout: function (name) {
      return request('POST', '/api/layouts/' + encodeURIComponent(name) + '/reset');
    },
    savePreference: function (key, value) {
      return request('POST', '/api/preferences/' + encodeURIComponent(key), { value: value });
    }
  };
})(window);
