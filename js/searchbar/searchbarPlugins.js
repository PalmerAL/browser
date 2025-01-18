var searchbar = document.getElementById('searchbar')
var searchbarUtils = require('searchbar/searchbarUtils.js')
var urlParser = require('util/urlParser.js')

var plugins = [] // format is {name, container, trigger, showResults}
var results = {} // format is {pluginName: [results]}
var URLOpener
var URLHandlers = [] // format is {trigger, action}

var topAnswer = {
  plugin: null,
  item: null
}

const searchbarPlugins = {
  topAnswerArea: searchbar.querySelector('.top-answer-area'),
  // empties all containers in the searchbar
  clearAll: function () {
    empty(searchbarPlugins.topAnswerArea)
    topAnswer = {
      plugin: null,
      item: null
    }
    for (var i = 0; i < plugins.length; i++) {
      empty(plugins[i].container)
      results[plugins[i].name] = []
    }
  },

  reset: function (pluginName) {
    empty(searchbarPlugins.getContainer(pluginName))

    var ta = searchbarPlugins.getTopAnswer(pluginName)
    if (ta) {
      ta.remove()
      topAnswer = {
        plugin: null,
        item: null
      }
    }

    results[pluginName] = []
  },

  getTopAnswer: function (pluginName) {
    if (pluginName) {
      if (topAnswer.plugin === pluginName) {
        return topAnswer.item
      } else {
        return null
      }
    } else {
      return searchbarPlugins.topAnswerArea.firstChild
    }
  },

  setTopAnswer: function (pluginName, data) {
    empty(searchbarPlugins.topAnswerArea)

    var item = searchbarUtils.createItem(data)
    item.setAttribute('data-plugin', pluginName)
    item.setAttribute('data-url', data.url)
    searchbarPlugins.topAnswerArea.appendChild(item)

    item.addEventListener('click', function (e) {
      URLOpener(data.url, e)
    })

    topAnswer = {
      plugin: pluginName,
      item: item
    }

    if (data.url) {
      data.urlKey = urlParser.removeTextFragment(data.url)
    }

    results[pluginName].push(data)
  },

  addResult: function (pluginName, data, options = {}) {
    if (options.allowDuplicates) {
      data.allowDuplicates = true
    }

    if (data.url) {
      data.urlKey = urlParser.removeTextFragment(data.url)
    }

    if (data.urlKey && !data.allowDuplicates) {
      // skip duplicates
      for (var plugin in results) {
        for (var i = 0; i < results[plugin].length; i++) {
          if (results[plugin][i].urlKey === data.urlKey && !results[plugin][i].allowDuplicates) {
            return
          }
        }
      }
    }

    if (data.url && !data.click) {
      data.click = function (e) {
        URLOpener(data.url, e)
      }
    }

    var item = searchbarUtils.createItem(data)

    if (data.url) {
      item.setAttribute('data-url', data.url)

      item.addEventListener('keyup', function (e) {
        /*  right arrow or space should autocomplete with selected item if it's
            a search suggestion */
        if (e.keyCode === 39 || e.keyCode === 32) {
          const input = document.getElementById('tab-editor-input')
          input.value = data.url
          input.focus()
        }
      })
    }

    searchbarPlugins.getContainer(pluginName).appendChild(item)

    results[pluginName].push(data)
  },

  addHeading: function (pluginName, data) {
    searchbarPlugins.getContainer(pluginName).appendChild(searchbarUtils.createHeading(data))
  },

  getContainer: function (pluginName) {
    for (var i = 0; i < plugins.length; i++) {
      if (plugins[i].name === pluginName) {
        return plugins[i].container
      }
    }
    return null
  },

  register: function (name, object) {
    // add the container
    var container = document.createElement('div')
    container.classList.add('searchbar-plugin-container')
    container.setAttribute('data-plugin', name)
    searchbar.insertBefore(container, searchbar.childNodes[object.index + 2])

    plugins.push({
      name: name,
      container: container,
      trigger: object.trigger,
      showResults: object.showResults
    })

    results[name] = []
  },

  run: function (text, input, inputFlags) {
    for (var i = 0; i < plugins.length; i++) {
      try {
        if (plugins[i].showResults && (!plugins[i].trigger || plugins[i].trigger(text))) {
          plugins[i].showResults(text, input, inputFlags)
        } else {
          searchbarPlugins.reset(plugins[i].name)
        }
      } catch (e) {
        console.error('error in searchbar plugin "' + plugins[i].name + '":', e)
      }
    }
  },

  registerURLHandler: function (handler) {
    URLHandlers.push(handler)
  },

  runURLHandlers: function (text) {
    for (var i = 0; i < URLHandlers.length; i++) {
      if (URLHandlers[i](text)) {
        return true
      }
    }
    return false
  },

  getResultCount: function (pluginName) {
    if (pluginName) {
      return results[pluginName].length
    } else {
      var resultCount = 0
      for (var plugin in results) {
        resultCount += results[plugin].length
      }
      return resultCount
    }
  },

  initialize: function (opener) {
    URLOpener = opener
  }
}

module.exports = searchbarPlugins
