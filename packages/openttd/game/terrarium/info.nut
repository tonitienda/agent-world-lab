class TerrariumInfo extends GSInfo {
    function GetAuthor() { return "The Agent Terrarium"; }
    function GetName() { return "Terrarium Bridge"; }
    function GetDescription() { return "Restricted JSON bridge for a disposable OpenTTD spike."; }
    function GetVersion() { return 1; }
    function GetDate() { return "2026-11-07"; }
    function CreateInstance() { return "TerrariumBridge"; }
    function GetShortName() { return "ATBR"; }
    function GetAPIVersion() { return "15"; }
}
RegisterGS(TerrariumInfo());
