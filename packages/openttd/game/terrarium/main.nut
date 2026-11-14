// Deliberately finite operations: never evaluate code supplied over the admin port.
class TerrariumBridge extends GSController {
    company = 0;
    cargo = null;
    delivered = 0;
    freight = null;

    function Save() { return {delivered = this.delivered, freight = this.freight}; }
    function Load(version, data) { if ("delivered" in data) this.delivered = data.delivered; if ("freight" in data) this.freight = data.freight; }

    function Reply(id, ok, data) {
        if (!GSAdmin.Send({id = id, ok = ok, data = data})) {
            GSAdmin.Send({id = id, ok = false, data = {error = "reply exceeds JSON limit"}});
        }
    }

    function Tile(x, y) {
        if (typeof x != "integer" || typeof y != "integer" || x < 1 || y < 1 ||
            x >= GSMap.GetMapSizeX() - 1 || y >= GSMap.GetMapSizeY() - 1) throw "invalid coordinates";
        return GSMap.GetTileIndex(x, y);
    }

    function Pos(tile) { return {x = GSMap.GetTileX(tile), y = GSMap.GetTileY(tile)}; }

    function Check(result) {
        if (!result) throw GSError.GetLastErrorString();
        return {success = true};
    }

    function PassengerCargo() {
        foreach (c, _ in GSCargoList()) {
            if (GSCargo.GetTownEffect(c) == GSCargo.TE_PASSENGERS) return c;
        }
        throw "no passenger cargo";
    }

    // Trusted fixture creation only. Never exposed as a player MCP tool.
    function SetupSupplyChain() {
        if (GSIndustry.GetIndustryCount() != 0) throw "supply-chain setup requires a fresh industry-free world";
        local mid = GSMap.GetMapSizeX() / 2;
        local vertical = GSTile.IsWaterTile(GSMap.GetTileIndex(mid, 20));
        if (!vertical && !GSTile.IsWaterTile(GSMap.GetTileIndex(20, mid))) throw "river fixture missing";
        local orient = function(x, y) : (vertical) { return vertical ? GSMap.GetTileIndex(x, y) : GSMap.GetTileIndex(y, x); };
        local forest_type = null, mill_type = null, wood = null, goods = null;
        foreach (t, _ in GSIndustryTypeList()) {
            local name = GSIndustryType.GetName(t).tolower();
            if (name.find("forest") != null) forest_type = t;
            if (name.find("sawmill") != null) mill_type = t;
        }
        foreach (c, _ in GSCargoList()) {
            if (GSCargo.GetCargoLabel(c) == "WOOD") wood = c;
            if (GSCargo.GetCargoLabel(c) == "GOOD") goods = c;
        }
        if (forest_type == null || mill_type == null || wood == null || goods == null) throw "required temperate supply chain unavailable";
        local types = [forest_type, mill_type], centres = [[38, 64], [82, 64]], built = [];
        for (local i = 0; i < 2; i++) {
            local made = false;
            for (local radius = 0; radius <= 10 && !made; radius += 2) {
                for (local dy = -radius; dy <= radius && !made; dy += 2) {
                    for (local dx = -radius; dx <= radius && !made; dx += 2) {
                        made = GSIndustryType.BuildIndustry(types[i], orient(centres[i][0] + dx, centres[i][1] + dy));
                    }
                }
            }
            if (!made) throw "could not place supply-chain industry";
            foreach (industry, _ in GSIndustryList()) {
                if (GSIndustry.GetIndustryType(industry) == types[i]) {
                    GSIndustry.SetControlFlags(industry, GSIndustry.INDCTL_NO_CLOSURE |
                        GSIndustry.INDCTL_NO_PRODUCTION_INCREASE | GSIndustry.INDCTL_NO_PRODUCTION_DECREASE);
                    built.append({id = industry, name = GSIndustryType.GetName(types[i]), position = this.Pos(GSIndustry.GetLocation(industry))});
                }
            }
        }
        local town_made = false;
        for (local delta = 0; delta <= 12 && !town_made; delta += 4)
            town_made = GSTown.FoundTown(orient(102 - delta, 92 + delta), GSTown.TOWN_SIZE_LARGE, true, GSTown.ROAD_LAYOUT_2x2, "Eastmere");
        local destination = null, nearest = 100000;
        foreach (town, _ in GSTownList()) {
            local tile = GSTown.GetLocation(town);
            local side = vertical ? GSMap.GetTileX(tile) : GSMap.GetTileY(tile);
            if (side < mid + 8) continue;
            local p = this.Pos(tile);
            local score = abs(p.x - (vertical ? 102 : 92)) + abs(p.y - (vertical ? 92 : 102));
            if (score < nearest) { nearest = score; destination = {id = town, name = GSTown.GetName(town), position = p}; }
        }
        if (destination == null) throw "no destination town on the mill bank";
        local crossing_heads = 0;
        for (local along = 1; along < GSMap.GetMapSizeX() - 1; along++) {
            for (local across = mid - 5; across <= mid + 5; across++) {
                if (GSBridge.IsBridgeTile(orient(across, along))) crossing_heads++;
            }
        }
        local acceptance_sites = 0;
        for (local dy = -16; dy <= 16; dy++) for (local dx = -16; dx <= 16; dx++) {
            local x = destination.position.x + dx, y = destination.position.y + dy;
            if (x < 1 || y < 1 || x >= GSMap.GetMapSizeX() - 1 || y >= GSMap.GetMapSizeY() - 1) continue;
            local tile = GSMap.GetTileIndex(x, y);
            if (GSTile.IsBuildable(tile) && GSTile.GetCargoAcceptance(tile, goods, 1, 1, 3) >= 8) acceptance_sites++;
        }
        this.freight = {forest = built[0].id, mill = built[1].id, town = destination.id,
            wood = wood, goods = goods, wood_delivered = 0, goods_delivered = 0, mill_goods_delivered = 0};
        return {river_axis = vertical ? "x" : "y", river_min = mid - 2, river_max = mid + 1,
            forest = built[0], sawmill = built[1], destination = destination, wood_cargo = wood, goods_cargo = goods,
            goods_acceptance_sites = acceptance_sites, industry_count = GSIndustry.GetIndustryCount(),
            initial_goods_production = GSIndustry.GetLastMonthProduction(built[1].id, goods),
            prebuilt_crossing_heads = crossing_heads,
            forest_produces_wood = GSIndustryType.GetProducedCargo(forest_type).HasItem(wood),
            sawmill_accepts_wood = GSIndustryType.GetAcceptedCargo(mill_type).HasItem(wood),
            sawmill_produces_goods = GSIndustryType.GetProducedCargo(mill_type).HasItem(goods)};
    }

    function FreightStatus() {
        local f = this.freight;
        if (f == null) throw "freight fixture unavailable";
        f.wood_delivered += GSCargoMonitor.GetIndustryDeliveryAmount(this.company, f.wood, f.mill, true);
        f.goods_delivered += GSCargoMonitor.GetTownDeliveryAmount(this.company, f.goods, f.town, true);
        // The engine's origin monitor credits cargo when it is delivered, not when it is loaded.
        if (!("mill_goods_delivered" in f)) f.mill_goods_delivered <- f.goods_picked_up;
        f.mill_goods_delivered += GSCargoMonitor.GetIndustryPickupAmount(this.company, f.goods, f.mill, true);
        local income = 0;
        // Five quarters cover all possible rollovers in the 240-day calibration.
        for (local q = 0; q <= 4; q++) income += GSCompany.GetQuarterlyIncome(this.company, q);
        local trucks = [];
        local fleet_profit = 0;
        foreach (v, _ in GSVehicleList()) {
            local profit = GSVehicle.GetProfitThisYear(v) + GSVehicle.GetProfitLastYear(v);
            fleet_profit += profit;
            trucks.append({id = v, position = this.Pos(GSVehicle.GetLocation(v)),
                wood = GSVehicle.GetCargoLoad(v, f.wood), goods = GSVehicle.GetCargoLoad(v, f.goods),
                speed = GSVehicle.GetCurrentSpeed(v)});
        }
        return {date = GSDate.GetCurrentDate(), balance = GSCompany.GetBankBalance(this.company),
            loan = GSCompany.GetLoanAmount(), income = income, fleet_profit = fleet_profit,
            wood = f.wood_delivered, goods = f.goods_delivered, mill_goods_delivered = f.mill_goods_delivered, trucks = trucks};
    }

    function Observe() {
        local towns = [];
        foreach (t, _ in GSTownList()) {
            this.delivered += GSCargoMonitor.GetTownDeliveryAmount(this.company, this.cargo, t, true);
            if (towns.len() == 4) break;
            towns.append({id = t, name = GSTown.GetName(t), population = GSTown.GetPopulation(t),
                position = this.Pos(GSTown.GetLocation(t))});
        }
        local vehicles = [];
        foreach (v, _ in GSVehicleList()) {
            if (vehicles.len() == 4) break;
            vehicles.append({id = v, position = this.Pos(GSVehicle.GetLocation(v)),
                profit = GSVehicle.GetProfitThisYear(v), load = GSVehicle.GetCargoLoad(v, this.cargo),
                capacity = GSVehicle.GetCapacity(v, this.cargo), speed = GSVehicle.GetCurrentSpeed(v)});
        }
        return {date = GSDate.GetCurrentDate(), paused = GSGame.IsPaused(),
            balance = GSCompany.GetBankBalance(this.company), loan = GSCompany.GetLoanAmount(),
            width = GSMap.GetMapSizeX(), height = GSMap.GetMapSizeY(),
            cargo = this.cargo, delivered = this.delivered, towns = towns, vehicles = vehicles};
    }

    // Bounded survey of vacant flat tiles immediately adjacent to existing roads.
    // It proposes no route and does not construct or clear anything.
    function Sites(a) {
        local centre = this.Tile(a.x, a.y);
        local radius = a.radius;
        if (typeof radius != "integer" || radius < 1 || radius > 16) throw "radius must be 1..16";
        local sites = [];
        for (local y = a.y - radius; y <= a.y + radius; y++) {
            for (local x = a.x - radius; x <= a.x + radius; x++) {
                if (x < 1 || y < 1 || x >= GSMap.GetMapSizeX() - 1 || y >= GSMap.GetMapSizeY() - 1) continue;
                local tile = this.Tile(x, y);
                if (!GSTile.IsBuildable(tile) || GSTile.GetSlope(tile) != GSTile.SLOPE_FLAT) continue;
                foreach (d in [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    local front = GSMap.GetTileIndex(x + d[0], y + d[1]);
                    if (!GSRoad.IsRoadTile(front)) continue;
                    sites.append({x = x, y = y, front_x = x + d[0], front_y = y + d[1],
                        town = GSTile.GetClosestTown(tile),
                        acceptance = GSTile.GetCargoAcceptance(tile, this.cargo, 1, 1, 3),
                        production = GSTile.GetCargoProduction(tile, this.cargo, 1, 1, 3)});
                    break;
                }
            }
        }
        // Individual records keep every JSON response below GSAdmin's limit.
        return sites;
    }

    function Act(op, a) {
        GSRoad.SetCurrentRoadType(GSRoad.ROADTYPE_ROAD);
        switch (op) {
            case "observe": return this.Observe();
            case "bootstrap": {
                this.Check(GSCompany.SetLoanAmount(a.loan));
                GSCompany.SetName("Claude Transit");
                return this.Observe();
            }
            case "map": {
                local rows = [];
                for (local y = a.y - a.radius; y <= a.y + a.radius; y++) {
                    local row = "";
                    for (local x = a.x - a.radius; x <= a.x + a.radius; x++) {
                        if (x < 1 || y < 1 || x >= GSMap.GetMapSizeX() - 1 || y >= GSMap.GetMapSizeY() - 1) { row += "#"; continue; }
                        local t = GSMap.GetTileIndex(x, y);
                        row += GSRoad.IsRoadTile(t) ? "R" : GSTile.IsWaterTile(t) ? "~" : GSTile.IsBuildable(t) ? (GSTile.GetSlope(t) == GSTile.SLOPE_FLAT ? "." : "s") : "X";
                    }
                    rows.append({y = y, x = a.x - a.radius, row = row});
                }
                return rows;
            }
            case "vehicle": {
                if (!GSVehicle.IsValidVehicle(a.vehicle)) throw "invalid vehicle";
                local orders = [];
                for (local i = 0; i < GSOrder.GetOrderCount(a.vehicle) && i < 8; i++)
                    orders.append({index = i, destination = this.Pos(GSOrder.GetOrderDestination(a.vehicle, i))});
                return {vehicle = a.vehicle, stopped_in_depot = GSVehicle.IsStoppedInDepot(a.vehicle), orders = orders};
            }
            case "stations": {
                local stations = [];
                foreach (s, _ in GSStationList(GSStation.STATION_BUS_STOP)) {
                    if (stations.len() == 4) break;
                    stations.append({id = s, name = GSBaseStation.GetName(s),
                        position = this.Pos(GSBaseStation.GetLocation(s)),
                        waiting = GSStation.GetCargoWaiting(s, this.cargo)});
                }
                return stations;
            }
            case "geometry": return {north_height = GSTile.GetMinHeight(GSMap.GetTileIndex(1, 1)),
                south_height = GSTile.GetMinHeight(GSMap.GetTileIndex(GSMap.GetMapSizeX() - 2, GSMap.GetMapSizeY() - 2))};
            case "sites": return this.Sites(a);
            case "freight_status": return this.FreightStatus();
            case "freight_stations": {
                local f = this.freight;
                if (f == null) throw "freight fixture unavailable";
                local stations = [];
                foreach (s, _ in GSStationList(GSStation.STATION_TRUCK_STOP)) {
                    stations.append({id = s, position = this.Pos(GSBaseStation.GetLocation(s)),
                        wood_waiting = GSStation.GetCargoWaiting(s, f.wood),
                        goods_waiting = GSStation.GetCargoWaiting(s, f.goods)});
                }
                return stations;
            }
            case "freight_sites": {
                local sites = [];
                local radius = GSStation.GetCoverageRadius(GSStation.STATION_TRUCK_STOP);
                for (local y = a.y - 6; y <= a.y + 6; y++) for (local x = a.x - 6; x <= a.x + 6; x++) {
                    if (x < 1 || y < 1 || x >= GSMap.GetMapSizeX() - 1 || y >= GSMap.GetMapSizeY() - 1) continue;
                    local tile = this.Tile(x, y);
                    if (!GSTile.IsBuildable(tile) || GSTile.GetSlope(tile) != GSTile.SLOPE_FLAT) continue;
                    local accepts = GSTile.GetCargoAcceptance(tile, a.cargo, 1, 1, radius);
                    local produces = GSTile.GetCargoProduction(tile, a.cargo, 1, 1, radius);
                    if (accepts >= 8 || produces > 0) sites.append({x = x, y = y, accepts = accepts, produces = produces});
                }
                return sites;
            }
            case "build_bridge": return this.Check(GSBridge.BuildBridge(GSVehicle.VT_ROAD, a.bridge,
                this.Tile(a.x, a.y), this.Tile(a.end_x, a.end_y)));
            case "build_freight_stop": return this.Check(GSRoad.BuildRoadStation(this.Tile(a.x, a.y),
                this.Tile(a.front_x, a.front_y), GSRoad.ROADVEHTYPE_TRUCK, GSStation.STATION_NEW));
            case "engines": {
                local engines = [];
                foreach (e, _ in GSEngineList(GSVehicle.VT_ROAD)) {
                    if (GSEngine.IsBuildable(e) && GSEngine.GetCargoType(e) == this.cargo && engines.len() < 4)
                        engines.append({id = e, name = GSEngine.GetName(e), price = GSEngine.GetPrice(e),
                            capacity = GSEngine.GetCapacity(e), annual_running_cost = GSEngine.GetRunningCost(e)});
                }
                return engines;
            }
            case "cargo_engines": {
                local engines = [];
                foreach (e, _ in GSEngineList(GSVehicle.VT_ROAD)) {
                    if (GSEngine.IsBuildable(e) && GSEngine.GetCargoType(e) == a.cargo && engines.len() < 4)
                        engines.append({id = e, name = GSEngine.GetName(e), price = GSEngine.GetPrice(e), capacity = GSEngine.GetCapacity(e)});
                }
                return engines;
            }
            case "bridge_options": {
                local bridges = [];
                foreach (b, _ in GSBridgeList_Length(a.length)) {
                    bridges.append({id = b, name = GSBridge.GetName(b, GSVehicle.VT_ROAD),
                        price = GSBridge.GetPrice(b, a.length), speed = GSBridge.GetMaxSpeed(b)});
                }
                bridges.sort(function(left, right) { return left.price - right.price; });
                return bridges.len() > 4 ? bridges.slice(0, 4) : bridges;
            }
            case "build_road": return this.Check(GSRoad.BuildRoad(this.Tile(a.x, a.y), this.Tile(a.end_x, a.end_y)));
            case "build_stop": return this.Check(GSRoad.BuildRoadStation(this.Tile(a.x, a.y),
                this.Tile(a.front_x, a.front_y), GSRoad.ROADVEHTYPE_BUS, GSStation.STATION_NEW));
            case "build_depot": return this.Check(GSRoad.BuildRoadDepot(this.Tile(a.x, a.y), this.Tile(a.front_x, a.front_y)));
            case "build_vehicle": {
                local v = GSVehicle.BuildVehicle(this.Tile(a.x, a.y), a.engine);
                if (!GSVehicle.IsValidVehicle(v)) throw GSError.GetLastErrorString();
                return {vehicle = v};
            }
            case "append_order": return this.Check(GSOrder.AppendOrder(a.vehicle, this.Tile(a.x, a.y),
                "full_load" in a && a.full_load ? GSOrder.OF_FULL_LOAD_ANY : GSOrder.OF_NONE));
            case "start_vehicle": return this.Check(GSVehicle.StartStopVehicle(a.vehicle));
            case "send_depot": return this.Check(GSVehicle.SendVehicleToDepot(a.vehicle));
            case "sell_vehicle": return this.Check(GSVehicle.SellVehicle(a.vehicle));
            case "remove_order": return this.Check(GSOrder.RemoveOrder(a.vehicle, a.index));
            case "set_loan": return this.Check(GSCompany.SetLoanAmount(a.amount));
        }
        throw "unsupported operation";
    }

    function Start() {
        this.SetCommandDelay(1);
        this.cargo = this.PassengerCargo();
        GSGame.Pause();
        while (true) {
            while (GSEventController.IsEventWaiting()) {
                local event = GSEventController.GetNextEvent();
                if (event.GetEventType() != GSEvent.ET_ADMIN_PORT) continue;
                local request = GSEventAdminPort.Convert(event).GetObject();
                local id = (typeof request == "table" && "id" in request) ? request.id : -1;
                try {
                    if (typeof request != "table" || !("op" in request) || !("args" in request)) throw "invalid request";
                    if (request.op == "setup_supply_chain") {
                        this.Reply(id, true, this.SetupSupplyChain());
                    } else if (request.op == "advance") {
                        local days = request.args.days;
                        if (typeof days != "integer" || days < 1 || days > 90) throw "days must be 1..90";
                        local start = GSDate.GetCurrentDate();
                        this.Check(GSGame.Unpause());
                        while (GSDate.GetCurrentDate() < start + days) this.Sleep(1);
                        this.Check(GSGame.Pause());
                        this.Reply(id, true, {start_date = start, end_date = GSDate.GetCurrentDate(), paused = GSGame.IsPaused()});
                    } else {
                        if (GSCompany.ResolveCompanyID(this.company) == GSCompany.COMPANY_INVALID) throw "company unavailable";
                        local mode = GSCompanyMode(this.company);
                        local result = this.Act(request.op, request.args);
                        mode = null;
                        if (request.op == "sites" || request.op == "map" || request.op == "freight_sites" || request.op == "freight_stations") {
                            foreach (site in result) GSAdmin.Send({id = id, item = site});
                            this.Reply(id, true, {count = result.len()});
                        } else this.Reply(id, true, result);
                    }
                } catch (error) {
                    this.Reply(id, false, {error = error == null ? "unknown game error" : error.tostring()});
                }
            }
            this.Sleep(1);
        }
    }
}
