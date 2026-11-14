class TerrariumIdleInfo extends AIInfo {
    function GetAuthor() { return "The Agent Terrarium"; }
    function GetName() { return "Terrarium Idle"; }
    function GetDescription() { return "Creates a company but never acts; the bridge owns gameplay."; }
    function GetVersion() { return 1; }
    function GetDate() { return "2026-11-07"; }
    function CreateInstance() { return "TerrariumIdle"; }
    function GetShortName() { return "ATID"; }
    function GetAPIVersion() { return "15"; }
}
RegisterAI(TerrariumIdleInfo());
