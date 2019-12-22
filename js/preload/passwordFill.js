/**
Simple username/password field detector and auto-filler.
 
When page is loaded, we try to find any input fields with specific name 
attributes. If we find something useful, we dispatch an IPC event 
'password-autofill' to signal that we want to check if there is auto-fill data
available.

When we receive back an IPC event 'password-autofill-match' with auto-fill 
data, we do one of two things:

- If there's a single credentials match, we fill the input fields with that 
  data.

- If there's more than one match, we add a focus event listener on the 
  username/email fields that will display a small overlay div with available 
  options. When user selects one of the options, we fill the input fields with 
  credentials data from the selection.

This code doesn't work with JS-based forms. We don't listen to all DOM changes,
we expect the login form to be present in the HTML code at page load. We can 
add a MutationObserver to the document, or DOMNodeInserted listener, but I 
wanted to keep it lightweight and not impact browser performace too much.
*/

const keyIcon = '<svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="key" class="svg-inline--fa fa-key fa-w-16" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M512 176.001C512 273.203 433.202 352 336 352c-11.22 0-22.19-1.062-32.827-3.069l-24.012 27.014A23.999 23.999 0 0 1 261.223 384H224v40c0 13.255-10.745 24-24 24h-40v40c0 13.255-10.745 24-24 24H24c-13.255 0-24-10.745-24-24v-78.059c0-6.365 2.529-12.47 7.029-16.971l161.802-161.802C163.108 213.814 160 195.271 160 176 160 78.798 238.797.001 335.999 0 433.488-.001 512 78.511 512 176.001zM336 128c0 26.51 21.49 48 48 48s48-21.49 48-48-21.49-48-48-48-48 21.49-48 48z"></path></svg>'

// Creates an unlock button element.
// 
// - input: Input element to 'attach' unlock button to.
function createUnlockButton(input) {
  // Container.
  var unlockDiv = document.createElement('div')

  // Style.
  unlockDiv.style.width = '20px'
  unlockDiv.style.height = '20px'
  unlockDiv.style.zIndex = 100

  // Position.
  unlockDiv.style.position = 'absolute'
  unlockDiv.style.left = (input.offsetLeft + input.offsetWidth - 20 - 10) + 'px'
  unlockDiv.style.top = (input.offsetTop + (input.offsetHeight - 20) / 2.0) + 'px'

  // Button.
  button = document.createElement('div')
  button.style.width = '20px'
  button.style.height = '20px'
  button.innerHTML = keyIcon
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    checkInputs()
  })
  unlockDiv.appendChild(button)

  return unlockDiv
}

// Tries to find if an element has a specific attribute value that contains at 
// least one of the values from 'matches' array.
function checkAttribute(element, attribute, matches) {
  let value = element.getAttribute(attribute)
  if (value == null) { return false }
  return matches.filter(match => value.toLowerCase().includes(match)).length > 0
}

// Gets all input fields on a page that contain at least one of the provided
// strings in their name attribute.
function getInputs(names, types) {
  let allFields = document.getElementsByTagName('input')

  let matchedFields = []
  for (let field of allFields) {
    if (!checkAttribute(field, 'type', types)) {
      continue
    }

    // We expect the field to have either 'name', 'formcontrolname' or 'id' attribute
    // that we can use to identify it as a login form input field.
    if (checkAttribute(field, 'name', names) || 
        checkAttribute(field, 'formcontrolname', names) || 
        checkAttribute(field, 'id', names)) {
      matchedFields.push(field)
    }
  }

  return matchedFields
}

// Shortcut to get username fields from a page.
function getUsernameFields() {
  return getInputs(['user', 'email', 'login', 'auth'], ['text', 'email'])
}

// Shortcut to get password fields from a page.
function getPasswordFields() {
  return getInputs(['pass'], ['password'])
}

// Removes credentials list overlay.
function removeAutocompleteList() {
  let list = document.getElementById('password-autocomplete-list')
  if (list != null) {
    list.parentNode.removeChild(list)
  }
}

// Populates username/password fields with provided credentials.
function fillCredentials(credentials) {
    const { username, password } = credentials
    
    for (let field of getUsernameFields()) {
      field.value = username
      field.dispatchEvent(new Event('change', { 'bubbles': true }))
    }

    for (let field of getPasswordFields()) {
      field.value = password
      field.dispatchEvent(new Event('change', { 'bubbles': true }))
    }
}

// Setup a focus/click listener on the username input fields.
//
// When those events happen, we add a small overlay with a list of matching 
// credentials. Clicking on an item in a list populates the input fields with 
// selected username/password pair.
//
// - element: input field to add a listener to
// - credentials: an array of { username, password } objects
function addFocusListener(element, credentials) {
  // Creates an options list container.
  function buildContainer() {
    let suggestionsDiv = document.createElement('div')
    suggestionsDiv.style = 'position: absolute; border: 1px solid #d4d4d4; z-index: 1; border-bottom: none; background: #FFFFFF;'
    suggestionsDiv.id = 'password-autocomplete-list'
    return suggestionsDiv
  }

  // Adds an option row to the list container.
  function addOption(parent, username) {
    let suggestionItem = document.createElement('div')
    suggestionItem.innerHTML = username
    suggestionItem.style = 'padding: 10px; cursor: pointer; background-color: #fff; border-bottom: 1px solid #d4d4d4;'

    // When user clicks on the suggestion, we populate the form inputs with selected credentials.
    suggestionItem.addEventListener('click', function(e) {
      let selectedCredentials = credentials.filter(el => { return el.username === username })[0]
      fillCredentials(selectedCredentials)
      removeAutocompleteList()
      element.focus()
    })

    parent.appendChild(suggestionItem)
  }

  // Creates autocomplete list and adds it below the activated field.
  function showAutocompleteList(e) {
    removeAutocompleteList()
    let container = buildContainer()
    for (cred of credentials) {
      addOption(container, cred.username)
    }
    element.parentNode.insertBefore(container, element.nextSibling)
  }

  element.addEventListener('focus', showAutocompleteList)
  element.addEventListener('click', showAutocompleteList)

  // Hide options overlay when user clicks out of the input field.
  document.addEventListener("click", function (e) {
    if (e.target != element) {
      removeAutocompleteList()
    }
  })

  // Show the autocomplete list right away if field is already focused.
  // Userful for login pages which auto-focus the input field on page load.
  if (element === document.activeElement) {
    showAutocompleteList()
  }
}

function checkInputs() {
  if (getUsernameFields().length + getPasswordFields().length > 0) {
    ipc.send('password-autofill')
  }
}

// Ref to added unlock button.
var currentFocusElement = null

// ref to currently focused input.
var currentFocusInput = null

function addUnlockButton(target) {
  const types = ['text', 'email', 'password']
  const names = ['user', 'email', 'login', 'auth', 'pass', 'password']

  // We expect the field to have either 'name', 'formcontrolname' or 'id' attribute
  // that we can use to identify it as a login form input field.
  if (typeof target.getAttribute === 'function' &&
      !target.focused && 
      checkAttribute(target, 'type', types) && 
      (checkAttribute(target, 'name', names) || 
       checkAttribute(target, 'formcontrolname', names) || 
       checkAttribute(target, 'id', names))) {
    // DANGER. Setting parent's position to relative. Potentially can break layouts, but so far I haven't found any bugs.
    target.parentElement.style.position = 'relative'
    let unlockButton = createUnlockButton(target)
    target.parentElement.appendChild(unlockButton)
    target.focused = true
    
    currentFocusElement = unlockButton
    currentFocusInput = target
  }
}

function checkFocus() {
  if (currentFocusInput != null) {
    addUnlockButton(currentFocusInput)
  }
}

function handleFocus(event) {
  addUnlockButton(event.target)
}

function handleBlur(event) {
  if (currentFocusElement !== null && currentFocusElement.parentElement != null) {
    currentFocusElement.parentElement.removeChild(currentFocusElement)
    currentFocusElement = null

    currentFocusInput.focused = false
    currentFocusInput = null
  }
}

// Handle credentials fetched from the backend. Credentials are expected to be 
// an array of { username, password, manager } objects.
ipc.on('password-autofill-match', (event, credentials) => {
  if (credentials.length == 1) {
    fillCredentials(credentials[0])
  } else {
    let firstField = getUsernameFields().filter(field => field.type != 'hidden')[0]
    addFocusListener(firstField, credentials)
    firstField.focus()
  }
})

// Trigger autofill check from keyboard shortcut.
ipc.on('password-autofill-shortcut', (event) => {
  checkInputs(true)
})

// Autofill enabled event handler. Initializes focus listeners for input fields.
ipc.on('password-autofill-enabled', (event) => {
  checkFocus()
})

// Add default focus event listeners.
window.addEventListener('blur', handleBlur, true)
window.addEventListener('focus', handleFocus, true)

// Check if password autofill is configured.
window.addEventListener('load', function (event) {
  ipc.send('password-autofill-check')
})
