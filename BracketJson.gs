/**
* Constructs all team information from Stats sheet
* @author Coppertine, Sinsa
* @remarks Requires mostly made bracket.json file. Uses Drive API to allow the user to download the bracket.json.
*/
function addJsonMenu() {
  let ui = SpreadsheetApp.getUi();
  ui.createMenu('Json Menu')
    .addItem("Export Qualifiers to Teams bracket.json", "exportQuallifiers")
    .addToUi();
}

function exportQuallifiers() {
  // Let's get the admin to upload the bracket.json so we can do the work for them...
  var html = HtmlService.createHtmlOutput(uploadJsonHTML)
    .setWidth(600)
    .setHeight(300);
  SpreadsheetApp.getUi()
    .showModalDialog(html, 'Upload bracket.json');
}


let QUALIFIER_CALCULATION_VALUES, MOD_LIST, QUALIFIED_LIST_VALUES;
function uploadJson(data, majorLeague) {
  let bracketJsonString = Utilities.newBlob(data.bytes, data.mimeType, "bracket.json");
  let bracketJson = JSON.parse(bracketJsonString.getDataAsString());

  // Let's go through each team
  let bracketTeams = bracketJson["Teams"];
  let is_1_player = SS.getSheetByName("Settings").getRange("C5").getValue() == "1v1";

  QUALIFIER_CALCULATION_VALUES = SS.getSheetByName("Quals Calcs").getRange("AM1:BS").getValues();
  QUALIFIED_LIST_VALUES = SS.getSheetByName("Quals Calcs").getRange("A3:B").getValues();
  MOD_LIST = [... new Set(QUALIFIER_CALCULATION_VALUES.map(val => val.slice(1))[0].filter(m => m).map(m => m.substr(0, 2)))];
  if (bracketTeams.length == 0) {

    // We need to get every single team in this bracket
    let namesToRequest = {};
    namesToRequest = SS.getSheetByName("TeamsReal").getRange("A2:D").getValues().map(x => ({ playername: x[1], id: x[0], teamname: x[3] }));

    //Logger.log(namesToRequest);
    if (namesToRequest.length === 0) return;

    namesToRequest.forEach((team) => {
      if (team.playername === "")
        return;

      if (!is_1_player && bracketTeams.findIndex((t) => t.FullName == team.teamname) != -1) {
        // Find the team that is found in bracketTeams and put in the new player
        bracketTeams[bracketTeams.findIndex((t) => t.FullName == team.teamname)].Players.push({
          id: team.id,
          username: team.playername
        });
        return;
      }

      let teamTmp = {
        FullName: is_1_player ? team.playername : team.teamname,
        FlagName: team.teamname.substr(0, 3).replace(":", "_").toUpperCase(),
        Acronym: team.teamname.substr(0, 3).replace(":", "_").toUpperCase(),
        SeedingResults: [],
        Seed: "",
        LastYearPlacing: 1,
        Players: [
          {
            id: team.id,
            username: team.playername
          }
        ]
      }
      bracketTeams.push(teamTmp);
    });
    bracketJson["Teams"] = bracketTeams;
  }


  let modifiedBracketTeams = [];
  bracketTeams.forEach((team) => {
    modifiedBracketTeams.push(getTeamQualifierScore(team, majorLeague));
  });

  // Here, mod seeds.. yay??
  let modCalculationTeams = [];
  modifiedBracketTeams.forEach((team) => {
    let calculationTeam = {
      FullName: team.FullName,
      Mods: []
    };
    // console.log(MOD_LIST);
    MOD_LIST.forEach(mod => {
      let filteredBeatmaps = team.SeedingResults.filter(result => {
        return result.Mod === mod;
      })[0]; // Apparently filter returns an array?? why?
      // console.log(filteredBeatmaps);
      // console.log(filteredBeatmaps.Beatmaps);
      let beatmaps = filteredBeatmaps.Beatmaps;
      let mapSeeds = Object.keys(beatmaps).length;
      let cumulativeMapSeeds = beatmaps.reduce((sum, map) => sum + map.Seed, 0);
      let avgMapSeeds = Math.floor(cumulativeMapSeeds / mapSeeds);
      // console.log(`cumulative = ${cumulativeMapSeeds}\nmapseeds = ${mapSeeds}\navg = ${avgMapSeeds}`);


      calculationTeam.Mods.push({
        Mod: mod,
        Seed: avgMapSeeds
      });
    });
    modCalculationTeams.push(calculationTeam);
  });

  MOD_LIST.forEach(mod => {
    //let modTeams = modCalculationTeams.filter()
    let sortedTeams = modCalculationTeams.sort((a, b) => {
      return b.Mods.find(resultMod => resultMod.Mod == mod).Seed - a.Mods.find(resultMod => resultMod.Mod == mod).Seed;
    });
    // console.log(sortedTeams);
    modifiedBracketTeams.forEach(team => {
      var index = sortedTeams.findIndex(calcTeam => calcTeam.FullName == team.FullName);
      var result = team.SeedingResults.find(result => result.Mod == mod);
      // console.log(`result: ${result}\nindex: ${index}`);
      result.Seed = index;
    });
  });

  bracketJson["Teams"] = modifiedBracketTeams;

  //return DriveApp.createFile(bracketJsonString).getUrl();
  let blobOutput = Utilities.newBlob([], "text/json", "bracket.json");
  return DriveApp.createFile(blobOutput.setDataFromString(JSON.stringify(bracketJson))).getDownloadUrl();
}

function getTeamQualifierScore(team) {
  const qualifiedList = QUALIFIED_LIST_VALUES.map(x => ({ name: x[1], place: x[0] })).filter(x => x);
  let qualifiedTeamName = team.FullName;

  qualifiedList.forEach((qualifiedTeam) => {
    if (qualifiedTeam.place != "" && qualifiedTeam.name === qualifiedTeamName) {
      team.Seed = qualifiedTeam.place.toString();
    }
  });

  // Go though all non null rows of Coloumn A in the sheet "QualifierCalculations" and find the row that is the same as the team name
  // then go through all non null columns and grab both the score and map id.
  const values = QUALIFIER_CALCULATION_VALUES.map((x, i) => x[0]);
  const index = values.findIndex(row => row == team.FullName);
  if (index != -1) {
    //  Logger.log("Found team name " + team.FullName + " at: " + index);
    // Found the team, now to grab the scores.
    // Since there are only 10 columns to go through
    const MAPPOOL_MAX_WIDTH = QUALIFIER_CALCULATION_VALUES[0].length;
    for (let i = 1; i <= MAPPOOL_MAX_WIDTH; i++) {

      let cellValue = QUALIFIER_CALCULATION_VALUES[index][i];
      let modValue = QUALIFIER_CALCULATION_VALUES[0][i]; // Hope no one uses 3 Letter mods in qualifers... why??
      if (!cellValue)
        cellValue = 0;
      if (modValue == "" || modValue == null || modValue == undefined)
        continue;
      modValue = modValue.slice(0, 2);
      let modResults = team.SeedingResults.filter((modResult) => modResult.Mod == modValue);
      let sortedModList = QUALIFIER_CALCULATION_VALUES.map(r => [0, i].map(index => r[index])).slice(2).filter(r => r[1] != "").sort((a, b) => {
        if (a[1] === b[1]) {
          return 0;
        }
        else {
          return (a[1] > b[1]) ? -1 : 1;
        }
      });


      if (modResults.length == 0) {
        //  Logger.log("Mod not found: " + modValue + ", adding mod in.");

        team.SeedingResults.push(
          {
            Beatmaps: [
              {
                ID: QUALIFIER_CALCULATION_VALUES[1][i],
                Score: cellValue,
                Seed: sortedModList.findIndex((value) => value[0] == team.FullName) + 1
              }
            ],
            Mod: modValue,
            Seed: 0
          }
        )
      } else {
        //  Logger.log("Found Mod " + modValue + ", adding beatmap in.");

        // Let's do seed sorting...
        let sortedModList = QUALIFIER_CALCULATION_VALUES.map(r => [0, i].map(index => r[index])).slice(2).filter(r => r[1] != "").sort((a, b) => {
          if (a[1] === b[1]) {
            return 0;
          }
          else {
            return (a[1] > b[1]) ? -1 : 1;
          }
        });
        team.SeedingResults[team.SeedingResults.findIndex(value => value.Mod == modValue)].Beatmaps.push(
          {
            ID: QUALIFIER_CALCULATION_VALUES[1][i],
            Score: cellValue,
            Seed: sortedModList.findIndex((value) => value[0] == team.FullName) + 1
          }
        )
      }
    }
  }
  return team;
}

function versionCheck() {
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Settings").getRange("A35").getValue().startsWith("HitomiChan_ | Stats Sheet ver 4"))
    throw "Not right Version";
  else 
    return true;
}

let uploadJsonHTML = `<!doctypehtml><base target=_top><style>@import url(https://fonts.googleapis.com/css2?family=Montserrat&display=swap);body{font-family:Montserrat,sans-serif}.upload-btn-wrapper{position:relative;overflow:hidden;cursor:pointer;font-family:Montserrat,sans-serif!important}.btn{border:2px solid gray;color:#000;background-color:#aaaa;padding:8px 20px;border-radius:8px;font-size:20px;font-weight:700;margin-bottom:10px;font-family:Montserrat,sans-serif;cursor:pointer}.btn[disabled]{background-color:gray!important;cursor:not-allowed}.upload-btn-wrapper:hover .btn{background-color:#aaa}.btn:hover{background-color:#aaa}.btn[disabled]:hover{background-color:gray}.upload-btn-wrapper input[type=file]{font-size:100px;position:absolute;left:0;top:0;opacity:0}#output{margin-top:10px;margin-bottom:10px}</style><form onsubmit=uploadthis(this)><div class=upload-btn-wrapper><button class=btn>Upload bracket.json</button> <input type=file accept=.json,text/json id=bracketUploadFile name=bracketFile> <span id=fileChosenTxt>No file chosen</span></div><input type=submit class=btn value=Submit></form><div id=output></div><p>Bracket Team Seeding Generator<br>© Coppertine, Sinsa</p><script>function uploadthis(e){let t=!0;google.script.run.withFailureHandler(e=>{document.getElementsByClassName("btn")[1].disabled=!0,document.getElementById("output").innerHTML='<p>This script can only function in the HitomiChan_ Stats Sheet, you can download here:<br><a href="https://drive.google.com/drive/folders/1o20TAh-EAKkd3X4RBFrcLVwunKd4yZCV">HitomiChan_ Tournament Sheets</a></p>',t=!1}).versionCheck();const n=e.bracketFile.files[0],o=new FileReader;t&&(o.onload=function(e){const t={mimeType:n.type,bytes:[...new Int8Array(e.target.result)]};document.getElementById("output").innerHTML="<p>Generating Players, this may take a while (aprox. 30 seconds)...</p>",google.script.run.withSuccessHandler(e=>updateUrl(e)).withFailureHandler(e=>errorShow(e)).uploadJson(t)},o.readAsArrayBuffer(n))}function updateUrl(e){document.getElementById("output").innerHTML='<a href="'+e+'">Updated Bracket.json</a>'}function errorShow(e){document.getElementById("output").innerHTML="<p>Woops! Something went wrong...</p>"}document.getElementById("bracketUploadFile").addEventListener("change",function(){document.getElementById("fileChosenTxt").textContent=this.files[0].name});</script>`;
