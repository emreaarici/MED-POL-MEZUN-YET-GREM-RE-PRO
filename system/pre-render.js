const fs = require('fs');
const path = require('path');

const projectDir = __dirname;
const userDataPath = process.env.USER_DATA_PATH;

const configPath = userDataPath ? path.join(userDataPath, 'config.json') : path.join(projectDir, 'src', 'config.json');
const txtPath = userDataPath ? path.join(userDataPath, 'isimler.txt') : path.join(projectDir, 'isimler.txt');
const jsonPath = userDataPath ? path.join(userDataPath, 'names.json') : path.join(projectDir, 'src', 'names.json');
const cachePath = userDataPath ? path.join(userDataPath, 'lineCache.json') : path.join(projectDir, 'src', 'lineCache.json');

try {
  // 1. Read config.json
  if (!fs.existsSync(configPath)) {
    console.error('[Pre-Render] Error: config.json not found!');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  // 2. Read names from isimler.txt
  if (!fs.existsSync(txtPath)) {
    console.error('[Pre-Render] Error: isimler.txt not found! Path tried: ' + txtPath);
    process.exit(1);
  }
  const content = fs.readFileSync(txtPath, 'utf8');
  const names = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  // Write to names.json (Remotion compatibility)
  fs.writeFileSync(jsonPath, JSON.stringify(names, null, 2), 'utf8');
  console.log(`[Pre-Render] Processed ${names.length} names → names.json`);

  // 3. Extract parameters
  const nameHeight = config.nameHeight || 160;
  const wrapNames = config.wrapNames === true;
  const caseMode = config.caseMode || 'uppercase';

  // 4. Calculate item heights
  // Each student block height matches nameHeight exactly.
  // If wrapNames is enabled and name is long, we allocate 2 * nameHeight.
  const itemHeights = [];
  const yOffsets = [];
  let currentOffset = 0;

  names.forEach(name => {
    let multiplier = 1;
    if (wrapNames) {
      const trName = caseMode === 'original' ? name : name.toLocaleUpperCase('tr-TR');
      if (trName.length > 20) {
        multiplier = 2;
      }
    }
    const h = nameHeight * multiplier;

    itemHeights.push(h);
    yOffsets.push(currentOffset);
    currentOffset += h;
  });

  const totalListHeight = currentOffset;

  // 5. Write lineCache.json
  const cacheObj = { itemHeights, yOffsets, totalListHeight };
  fs.writeFileSync(cachePath, JSON.stringify(cacheObj, null, 2), 'utf8');
  console.log(`[Pre-Render] lineCache written — totalListHeight: ${totalListHeight}px`);

} catch (error) {
  console.error('[Pre-Render] Error:', error);
  process.exit(1);
}
