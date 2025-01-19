/* Uses Electron's safeStorage to encrypt a password file - encryption key gets stored in the system keychain */

const safeStorage = require('electron').safeStorage
const passwordFilePath = path.join(userDataPath, 'passwordStore')

/*
file format:
{
  version: 1,
  credentials: [
    {
      domain:,
      username:,
      password:
    }
  ]
}
*/

function readSavedPasswordFile () {
  let file
  try {
    file = fs.readFileSync(passwordFilePath)
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn(e)
      throw new Error(e)
    }
  }
  if (file) {
    return JSON.parse(safeStorage.decryptString(file))
  } else {
    return {
      version: 1,
      credentials: []
    }
  }
}

function writeSavedPasswordFile (content) {
  fs.writeFileSync(passwordFilePath, safeStorage.encryptString(JSON.stringify(content)))
}

function credentialStoreSetPasswordBulk (accounts) {
  const fileContent = readSavedPasswordFile()

  fileContent.credentials = accounts
  writeSavedPasswordFile(fileContent)
}

function credentialStoreSetPassword (account) {
  const fileContent = readSavedPasswordFile()

  // delete duplicate credentials
  for (let i = 0; i < fileContent.credentials.length; i++) {
    if (fileContent.credentials[i].domain === account.domain && fileContent.credentials[i].username === account.username) {
      fileContent.credentials.splice(i, 1)
      i--
    }
  }

  fileContent.credentials.push(account)
  writeSavedPasswordFile(fileContent)
}

ipc.handle('credentialStoreSetPasswordBulk', async function (event, accounts) {
  return credentialStoreSetPasswordBulk(accounts)
})

ipc.handle('credentialStoreSetPassword', async function (event, account) {
  return credentialStoreSetPassword(account)
})

ipc.handle('credentialStoreDeletePassword', async function (event, account) {
  const fileContent = readSavedPasswordFile()

  // delete matching credentials
  for (let i = 0; i < fileContent.credentials.length; i++) {
    if (fileContent.credentials[i].domain === account.domain && fileContent.credentials[i].username === account.username) {
      fileContent.credentials.splice(i, 1)
      i--
    }
  }

  return writeSavedPasswordFile(fileContent)
})

ipc.handle('credentialStoreGetCredentials', async function () {
  return readSavedPasswordFile().credentials
})
