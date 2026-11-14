-- Agent bridge. Runs inside the Hedgewars engine as the game "style" script.
--
-- Out: game state is printed to the engine console as short
--      `@@kind key=value ...` lines (engine strings are capped at 255 bytes,
--      so every line carries one fact).
-- In:  the controller writes Scripts/AgentCtl/cmd-<seq>.lua, a one-line Lua file
--      that sets the global AgentCommand. We look for the next one every 20
--      ticks. The script then presses the buttons for
--      the current hedgehog on exact game ticks.
--
-- The turn clock is frozen while we wait for a command, so a slow model never
-- runs out of turn time.

local CMD_DIR = "/Scripts/AgentCtl/"
local WEAPONS = {bazooka = amBazooka, grenade = amGrenade}

local hogs = {}
local shells = {}
local lastSeq = 0
local waiting = false   -- true while the current hedgehog has not been told what to do
local pressAt, holdFor = nil, 0
local fuse = nil        -- grenade fuse in seconds, set once the weapon switch has gone through
local releaseAt = nil   -- tick at which to let go of the attack button
local stopWalkAt = nil  -- tick at which to let go of the walk button
local misfireAt = nil   -- tick by which a shot must have left the barrel
local reportAt = nil    -- tick at which a walk or jump has settled and is reported
local CELL = 32         -- terrain is reported on a grid of this many pixels

local function emit(s) WriteLnToConsole("@@" .. s) end

local function hogLine(gear)
    local angle = GetGearValues(gear)
    return string.format("hog t=%d id=%d clan=%d hp=%d x=%d y=%d angle=%s cur=%d name=%s",
        GameTime, gear, GetHogClan(gear), GetHealth(gear), GetX(gear), GetY(gear),
        tostring(angle), gear == CurrentHedgehog and 1 or 0, GetHogName(gear))
end

local function snapshot()
    for gear, _ in pairs(hogs) do emit(hogLine(gear)) end
end

-- Coarse terrain map, one text row per grid row: '#' solid, '.' empty.
-- A cell counts as solid when the 8x8 block at its centre touches land.
local function terrain()
    local w, h = LAND_WIDTH or 4096, LAND_HEIGHT or 2048
    for row = 0, h / CELL - 1 do
        local cells = {}
        for col = 0, w / CELL - 1 do
            local x, y = col * CELL, row * CELL
            cells[#cells + 1] = TestRectForObstacle(x + 12, y + 12, x + CELL - 12, y + CELL - 12, true) and "#" or "."
        end
        emit("row y=" .. row .. " cells=" .. table.concat(cells))
    end
    emit(string.format("land w=%d h=%d cell=%d water=%s", w, h, CELL, tostring(WaterLine)))
end

local function setMessage(hog, flag, on)
    local msg = GetGearMessage(hog)
    if on then msg = bor(msg, flag) else msg = band(msg, bnot(flag)) end
    SetGearMessage(hog, msg)
end

local function run(c)
    local hog = CurrentHedgehog
    if not hog or not hogs[hog] then emit("reject seq=" .. c.seq .. " why=no-hog") return end
    waiting = false
    SetTurnTimePaused(false)
    if c.kind == "shoot" then
        -- angle: 0 = straight up, 1024 = horizontal, 2048 = straight down.
        -- power: ticks to hold the button, 1..1500 (1500 = full power).
        HogTurnLeft(hog, c.facing == "left")
        SetWeapon(WEAPONS[c.weapon] or amBazooka)
        fuse = c.timer
        SetGearValues(hog, c.angle)
        -- Switching weapon clears pressed buttons, so press attack a moment later.
        pressAt = GameTime + 200
        holdFor = c.power
    elseif c.kind == "walk" then
        HogTurnLeft(hog, c.facing == "left")
        setMessage(hog, c.facing == "left" and gmLeft or gmRight, true)
        stopWalkAt = GameTime + c.ms
    elseif c.kind == "jump" then
        HogTurnLeft(hog, c.facing == "left")
        ParseCommand(c.high and "hjump" or "ljump")
        reportAt = GameTime + 2000
    elseif c.kind == "skip" then
        ParseCommand("skip")
    end
    emit(string.format("ack t=%d seq=%d cmd=%s hog=%d", GameTime, c.seq, c.kind, hog))
end

local function poll()
    AgentCommand = nil
    -- One file per command (cmd-1.lua, cmd-2.lua, ...): a file is never rewritten,
    -- so we cannot catch one half-written.
    HedgewarsScriptLoad(CMD_DIR .. "cmd-" .. (lastSeq + 1) .. ".lua", false)
    local c = AgentCommand
    if c and c.seq == lastSeq + 1 then
        lastSeq = c.seq
        run(c)
    end
end

function onGameStart()
    emit("start t=" .. GameTime)
    snapshot()
end

function onNewTurn()
    waiting = true
    pressAt, releaseAt, stopWalkAt, reportAt, misfireAt = nil, nil, nil, nil, nil
    SetReadyTimeLeft(0)
    SetTurnTimePaused(true)
    terrain()
    snapshot()
    -- Emitted last: by the time the controller sees `turn`, the snapshot is complete.
    emit(string.format("turn t=%d hog=%d wind=%s", GameTime, CurrentHedgehog or 0, tostring(GetWind())))
end

function onGearAdd(gear)
    local gt = GetGearType(gear)
    if gt == gtHedgehog then
        hogs[gear] = true
    elseif gt == gtShell or gt == gtGrenade then
        shells[gear] = true
        misfireAt = nil
        local dx, dy = GetGearVelocity(gear)
        emit(string.format("shot t=%d id=%d x=%d y=%d dx=%s dy=%s", GameTime, gear, GetX(gear), GetY(gear), tostring(dx), tostring(dy)))
    end
end

function onGearDelete(gear)
    if hogs[gear] then
        hogs[gear] = nil
        emit(string.format("dead t=%d id=%d", GameTime, gear))
    elseif shells[gear] then
        shells[gear] = nil
        emit(string.format("impact t=%d id=%d x=%d y=%d", GameTime, gear, GetX(gear), GetY(gear)))
    end
end

function onGearDamage(gear, damage)
    if hogs[gear] then emit(string.format("damage t=%d id=%d dmg=%d hp=%d", GameTime, gear, damage, GetHealth(gear))) end
end

function onGameTick()
    local hog = CurrentHedgehog
    if pressAt and GameTime >= pressAt then
        pressAt = nil
        if hog and hogs[hog] then
            -- Asked for any earlier, the fuse setting lands on the previous weapon and changes it.
            if fuse then ParseCommand("timer " .. fuse) end
            fuse = nil
            setMessage(hog, gmAttack, true)
            releaseAt = GameTime + holdFor
        end
    elseif releaseAt and GameTime >= releaseAt then
        releaseAt = nil
        if hog and hogs[hog] then setMessage(hog, gmAttack, false) end
        misfireAt = GameTime + 1500
    end
    if misfireAt and GameTime >= misfireAt then
        -- Nothing was fired (no ammo, hedgehog mid-air...): do not leave the turn hanging.
        misfireAt = nil
        emit(string.format("misfire t=%d hog=%d", GameTime, hog or 0))
        EndTurn(true)
    end
    if stopWalkAt and GameTime >= stopWalkAt then
        stopWalkAt = nil
        if hog and hogs[hog] then
            setMessage(hog, bor(gmLeft, gmRight), false)
            reportAt = GameTime + 400 -- let the hedgehog come to rest
        end
    end
    if reportAt and GameTime >= reportAt then
        reportAt = nil
        if hog and hogs[hog] then
            -- Moving does not end the turn: freeze the clock and wait for the next command.
            SetTurnTimePaused(true)
            waiting = true
            emit(hogLine(hog))
            emit(string.format("moved t=%d hog=%d", GameTime, hog))
        end
    end
    if GameTime % 20 == 0 then
        if waiting then poll() end
        if GameTime % 500 == 0 then emit(string.format("tick t=%d hog=%d", GameTime, hog or 0)) end
    end
end

function onGameResult(winner)
    emit(string.format("over t=%d winner=%s", GameTime, tostring(winner)))
end


-- With the "drawn" map generator the engine expects the script to supply the land.
-- One thick rolling stroke gives an open island: gentle hills, no caves or overhangs.
function onGameInit()
  if MapGen ~= mgDrawn then return end
  local ridge = {{1350, 1800}, {1650, 1720}, {1950, 1790}, {2250, 1700}, {2550, 1780}, {2800, 1740}}
  for i, p in ipairs(ridge) do
    if i == 1 then AddPoint(p[1], p[2], 30) else AddPoint(p[1], p[2]) end
  end
  FlushPoints()
end
