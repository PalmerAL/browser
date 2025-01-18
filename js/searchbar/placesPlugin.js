var searchbar = require('searchbar/searchbar.js')
var searchbarPlugins = require('searchbar/searchbarPlugins.js')
var searchbarUtils = require('searchbar/searchbarUtils.js')
var searchbarAutocomplete = require('util/autocomplete.js')
var urlParser = require('util/urlParser.js')
var readerDecision = require('readerDecision.js')
var browserUI = require('browserUI.js')

var places = require('places/places.js')
var searchEngine = require('util/searchEngine.js')

var currentResponseSent = 0

async function showSearchbarPlaceResults (text, input, inputFlags, pluginName = 'places') {
  var responseSent = Date.now()

  var searchFn, resultCount
  if (pluginName === 'fullTextPlaces') {
    searchFn = places.searchPlacesFullText
    resultCount = 4 - searchbarPlugins.getResultCount('places')
  } else {
    searchFn = places.searchPlaces
    resultCount = 4
  }

  // only autocomplete an item if the delete key wasn't pressed
  var canAutocomplete = !inputFlags.isDeletion

  let results = await searchFn(text)

  // prevent responses from returning out of order
  if (responseSent < currentResponseSent) {
    return
  }

  currentResponseSent = responseSent

  searchbarPlugins.reset(pluginName)

  results = results.slice(0, resultCount)

  results.forEach(function (result, index) {
    var didAutocompleteResult = false

    var searchQuery = searchEngine.getSearch(result.url)

    if (canAutocomplete) {
      // if the query is autocompleted, pressing enter will search for the result using the current search engine, so only pages from the current engine should be autocompleted
      if (searchQuery && searchQuery.engine === searchEngine.getCurrent().name && index === 0) {
        var acResult = searchbarAutocomplete.autocomplete(input, [searchQuery.search])
        if (acResult.valid) {
          canAutocomplete = false
          didAutocompleteResult = true
        }
      } else {
        var autocompletionType = searchbarAutocomplete.autocompleteURL(input, result.url)

        if (autocompletionType !== -1) {
          canAutocomplete = false
        }

        if (autocompletionType === 0) { // the domain was autocompleted, show a domain result item
          var domain = new URL(result.url).hostname

          searchbarPlugins.setTopAnswer(pluginName, {
            title: domain,
            url: domain,
            fakeFocus: true
          })
        }
        if (autocompletionType === 1) {
          didAutocompleteResult = true
        }
      }
    }

    var url = result.url

    if (result.searchFragment && pluginName === 'fullTextPlaces' && !url.includes('#')) {
      var fragment = '#:~:text='
      if (result.searchFragment.contextBefore) {
        fragment += encodeURIComponent(result.searchFragment.contextBefore).replace(/-/g, '%2d') + '-,'
      }
      fragment += encodeURIComponent(result.searchFragment.fragment).replace(/-/g, '%2d')
      if (result.searchFragment.contextAfter) {
        fragment += ',-' + encodeURIComponent(result.searchFragment.contextAfter).replace(/-/g, '%2d')
      }
      url += fragment
    }

    var data = {
      url: url,
      metadata: result.tags,
      descriptionBlock: result.searchSnippet,
      highlightedTerms: (result.searchSnippet ? text.toLowerCase().split(' ').filter(t => t.length > 0) : []),
      delete: function () {
        places.deleteHistory(result.url)
      },
      icon: 'carbon:wikis'
    }

    if (searchQuery) {
      data.title = searchQuery.search
      data.secondaryText = searchQuery.engine
      data.icon = 'carbon:search'
    } else {
      data.title = urlParser.prettyURL(urlParser.getSourceURL(result.url))
      data.secondaryText = searchbarUtils.getRealTitle(result.title)
    }

    /* Alternative result format for switch-to-tab */

    // click handler for switch-to-tab results
    function onSwitchClick (task) {
      // if we created a new tab but are switching away from it, destroy the current (empty) tab
      var currentTabUrl = tabs.get(tabs.getSelected()).url
      if (!currentTabUrl) {
        browserUI.closeTab(tabs.getSelected())
      }
      if (task.id !== tasks.getSelected().id) {
        browserUI.switchToTask(task.id)
      }
      browserUI.switchToTab(task.tabs.get().find(tab => urlParser.removeTextFragment(tab.url) === urlComparisonBase).id)
    }

    const urlComparisonBase = urlParser.removeTextFragment(url)
    const matchingTasks = tasks.filter(task => task.tabs.get().some(tab => urlParser.removeTextFragment(tab.url) === urlComparisonBase)).sort((a, b) => {
      return tasks.getLastActivity(b.id) - tasks.getLastActivity(a.id)
    }).slice(0, 2)

    if (matchingTasks.length > 0 && !didAutocompleteResult && urlComparisonBase !== tabs.get(tabs.getSelected()).url && url !== tabs.get(tabs.getSelected()).url) {
      data.textActionButtons = []

      const currentTaskMatch = matchingTasks.find(task => task.id === tasks.getSelected().id)

      if (currentTaskMatch) {
        data.textActionButtons.push({
          icon: 'carbon:arrow-up-right',
          text: l('placesPluginSwitchToTab'),
          fn: function (e) {
            onSwitchClick(currentTaskMatch)
          }
        })
      }

      data.textActionButtons.push({
        text: l('placesPluginOpenAgain'),
        fn: function (e) {
          searchbar.openURL(url)
        }
      })

      matchingTasks.filter(task => task.id !== currentTaskMatch?.id).forEach(task => {
        const taskName = (task.name ? '"' + task.name + '"' : l('defaultTaskName').replace('%n', tasks.getIndex(task.id) + 1))
        data.textActionButtons.push({
          icon: 'carbon:arrow-up-right',
          text: (task.id === tasks.getSelected().id) ? l('placesPluginSwitchToTab') : l('placesPluginSwitchToTask').replace('%t', taskName),
          fn: function (e) {
            onSwitchClick(task)
          }
        })
      })

      data.textActionButtons[0].default = true

      data.click = function (e) {
        data.textActionButtons[0].fn(e)
      }
    }

    // show a star for bookmarked items
    if (result.isBookmarked) {
      data.icon = 'carbon:star-filled'
    } else if (readerDecision.shouldRedirect(result.url) === 1) {
      // show an icon to indicate that this page will open in reader view
      data.icon = 'carbon:notebook'
    }

    // create the item

    if (didAutocompleteResult) { // if this exact URL was autocompleted, show the item as the top answer
      data.fakeFocus = true
      searchbarPlugins.setTopAnswer(pluginName, data)
    } else {
      searchbarPlugins.addResult(pluginName, data)
    }
  })
}

function initialize () {
  searchbarPlugins.register('places', {
    index: 1,
    trigger: function (text) {
      return !!text && text.indexOf('!') !== 0
    },
    showResults: showSearchbarPlaceResults
  })

  searchbarPlugins.register('fullTextPlaces', {
    index: 2,
    trigger: function (text) {
      return !!text && text.indexOf('!') !== 0
    },
    showResults: debounce(function () {
      if (searchbarPlugins.getResultCount('places') < 4 && searchbar.associatedInput) {
        showSearchbarPlaceResults.apply(this, Array.from(arguments).concat('fullTextPlaces'))
      } else {
        // can't show results, clear any previous ones
        searchbarPlugins.reset('fullTextPlaces')
      }
    }, 200)
  })
}

module.exports = { initialize }
