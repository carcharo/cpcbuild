-- cpcbuild.lua -- the CPCBuild Aseprite extension: menu commands and dialogs.
-- MIT licensed, like the rest of cpcbuild (see LICENSE).
-- The logic is in cpcbuild_core.lua (no dialogs there, so it can be tested).

local cpc

-- Pixel widths offered for a mode: 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24
-- and 32 bytes. Always a multiple of the pixels per byte.
local BYTE_WIDTHS = { 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32 }

local function width_options(mode)
  local o = {}
  for _, b in ipairs(BYTE_WIDTHS) do o[#o + 1] = tostring(b * cpc.PPB[mode]) end
  return o
end

local function show_error(msg)
  app.alert{ title = "CPCBuild", text = msg }
end

-- ---------------------------------------------------------------- New sprite

local function new_sprite_command(plugin)
  local pref = plugin.preferences
  local dlg = Dialog("New CPC Sprite")
  local function sync()
    local m = tonumber(dlg.data.mode)
    for k = 0, 2 do dlg:modify{ id = "w" .. k, visible = (k == m) } end
  end
  dlg:combobox{ id = "mode", label = "Mode", options = { "0", "1", "2" },
                option = tostring(pref.mode or 0), onchange = sync }
  for k = 0, 2 do
    dlg:combobox{ id = "w" .. k, label = "Frame width (px)", options = width_options(k),
                  option = tostring(pref["w" .. k] or width_options(k)[2]) }
  end
  dlg:number{ id = "h", label = "Frame height (px)", text = tostring(pref.h or 16), decimals = 0 }
  dlg:number{ id = "frames", label = "Frames", text = tostring(pref.frames or 4), decimals = 0 }
  dlg:check{ id = "masked", label = "Masked", text = "index 0 is transparent", selected = pref.masked or false }
  dlg:entry{ id = "name", label = "Name", text = pref.name or "hero" }
  dlg:button{ id = "ok", text = "OK", focus = true }
  dlg:button{ id = "cancel", text = "Cancel" }
  sync()
  dlg:show()
  local d = dlg.data
  if not d.ok then return end
  local mode = tonumber(d.mode)
  local sprite, err = cpc.new_sprite{ mode = mode, w = tonumber(d["w" .. mode]), h = math.floor(d.h),
                                      frames = math.floor(d.frames), masked = d.masked, name = d.name }
  if not sprite then return show_error(err) end
  pref.mode, pref["w" .. mode], pref.h, pref.frames = mode, d["w" .. mode], d.h, d.frames
  pref.masked, pref.name = d.masked, d.name
  app.sprite = sprite
  app.refresh()
end

-- ---------------------------------------------------------------- New tileset

local function new_tileset_command(plugin)
  local pref = plugin.preferences
  local dlg = Dialog("New CPC Tileset")
  local function opts(mode)
    local o = {}
    for _, w in ipairs(cpc.tile_widths(mode)) do o[#o + 1] = tostring(w) end
    return o
  end
  local function sync()
    local m = tonumber(dlg.data.mode)
    for k = 0, 2 do dlg:modify{ id = "tw" .. k, visible = (k == m) } end
  end
  dlg:combobox{ id = "mode", label = "Mode", options = { "0", "1", "2" },
                option = tostring(pref.tmode or 0), onchange = sync }
  for k = 0, 2 do
    -- 8 pixels is the library's default tile width in every mode
    dlg:combobox{ id = "tw" .. k, label = "Tile width (px)", options = opts(k), option = "8" }
  end
  dlg:number{ id = "count", label = "Tiles (canvas hint)", text = tostring(pref.tcount or 16), decimals = 0 }
  dlg:entry{ id = "name", label = "Name", text = pref.tname or "tiles" }
  dlg:button{ id = "ok", text = "OK", focus = true }
  dlg:button{ id = "cancel", text = "Cancel" }
  sync()
  dlg:show()
  local d = dlg.data
  if not d.ok then return end
  local mode = tonumber(d.mode)
  local sprite, err = cpc.new_tileset{ mode = mode, tw = tonumber(d["tw" .. mode]),
                                       count = math.floor(d.count), name = d.name }
  if not sprite then return show_error(err) end
  pref.tmode, pref.tcount, pref.tname = mode, d.count, d.name
  app.sprite = sprite
  app.refresh()
end

-- ---------------------------------------------------------------- settings

-- Settings for a sprite that was not made with New: ask for them (and store
-- them in the sprite). Returns nil if cancelled.
local function ask_meta(sprite)
  local m = cpc.get_meta(sprite)
  if m then return m end
  local istiles = false
  for _, l in ipairs(sprite.layers) do if l.isTilemap then istiles = true end end
  local dlg = Dialog("CPCBuild settings")
  dlg:label{ text = "This sprite was not made by File > CPCBuild > New." }
  dlg:combobox{ id = "mode", label = "Mode", options = { "0", "1", "2" }, option = "0" }
  if istiles then
    dlg:number{ id = "tw", label = "Tile width (px)", text = "8", decimals = 0 }
  else
    dlg:check{ id = "masked", label = "Masked", text = "index 0 is transparent" }
  end
  dlg:entry{ id = "name", label = "Name", text = app.fs.fileTitle(sprite.filename) }
  dlg:button{ id = "ok", text = "OK", focus = true }
  dlg:button{ id = "cancel", text = "Cancel" }
  dlg:show()
  local d = dlg.data
  if not d.ok then return nil end
  local mode = tonumber(d.mode)
  if istiles then
    m = { kind = "tiles", mode = mode, name = cpc.clean_name(d.name), tw = math.floor(d.tw) }
  else
    m = { kind = "sprite", mode = mode, name = cpc.clean_name(d.name),
          fw = sprite.width, fh = sprite.height, masked = d.masked }
  end
  cpc.set_meta(sprite, m)
  return m
end

-- ---------------------------------------------------------------- Check

local function report_lines(rep)
  local lines = {}
  if #rep.errors == 0 then lines[#lines + 1] = "OK: no problems found." end
  for _, e in ipairs(rep.errors) do lines[#lines + 1] = "ERROR: " .. e end
  for _, w in ipairs(rep.warnings) do lines[#lines + 1] = "warning: " .. w end
  for _, i in ipairs(rep.info) do lines[#lines + 1] = i end
  return lines
end

local function check_command()
  local sprite = app.sprite
  if not sprite then return show_error("No sprite is open.") end
  if not ask_meta(sprite) then return end
  local frame = app.frame and app.frame.frameNumber or 1
  local rep = cpc.check(sprite, { frame = frame })
  local buttons = { "OK" }
  if #rep.bad > 0 then buttons[2] = "Select the " .. #rep.bad .. " off-palette pixels" end
  local pressed = app.alert{ title = "Check for CPC", text = report_lines(rep), buttons = buttons }
  if pressed == 2 then
    cpc.select_bad(sprite, rep)
    app.refresh()
  end
end

-- ---------------------------------------------------------------- Export

local function export_command(plugin)
  local sprite = app.sprite
  if not sprite then return show_error("No sprite is open.") end
  local meta = ask_meta(sprite)
  if not meta then return end
  local pref = plugin.preferences
  local start = sprite.filename
  local dir = app.fs.isFile(start) and app.fs.filePath(start) or (pref.dir or app.fs.userDocsPath)
  local dlg = Dialog("Export for CPCBuild")
  dlg:file{ id = "png", label = "Sheet PNG", save = true, entry = true, filetypes = { "png" },
            filename = app.fs.joinPath(dir, meta.name .. ".png") }
  if meta.kind == "tiles" then
    dlg:check{ id = "tmx", label = "Tiled map", text = "also write NAME.tmx", selected = pref.tmx ~= false }
  end
  dlg:button{ id = "ok", text = "Export", focus = true }
  dlg:button{ id = "cancel", text = "Cancel" }
  dlg:show()
  local d = dlg.data
  if not d.ok then return end
  local o = { dir = app.fs.filePath(d.png), name = app.fs.fileTitle(d.png), tmx = d.tmx, layer = app.layer }
  pref.dir = o.dir
  if meta.kind == "tiles" then pref.tmx = d.tmx end
  local r, err, rep = cpc.export(sprite, o)
  if not r and rep and #rep.errors > 0 then
    local lines = report_lines(rep)
    local pressed = app.alert{ title = "Export for CPCBuild", text = lines,
                               buttons = { "Cancel", "Export anyway" } }
    if pressed ~= 2 then return end
    o.force = true
    r, err = cpc.export(sprite, o)
  end
  if not r then return show_error(err) end
  local lines = { "Wrote:" }
  for _, f in ipairs(r.files) do lines[#lines + 1] = f end
  lines[#lines + 1] = string.format("Sheet: %dx%d pixels, %d columns, %d %s",
    r.sheet.w, r.sheet.h, r.sheet.cols, r.sheet.count, meta.kind == "tiles" and "tiles" or "frames")
  app.alert{ title = "Export for CPCBuild", text = lines }
end

-- ---------------------------------------------------------------- plugin

function init(plugin)
  cpc = dofile(app.fs.joinPath(plugin.path, "cpcbuild_core.lua"))
  plugin:newMenuGroup{ id = "cpcbuild_menu", title = "CPCBuild", group = "file_scripts" }
  plugin:newCommand{ id = "CpcNewSprite", title = "New CPC Sprite...", group = "cpcbuild_menu",
                     onclick = function() new_sprite_command(plugin) end }
  plugin:newCommand{ id = "CpcNewTileset", title = "New CPC Tileset...", group = "cpcbuild_menu",
                     onclick = function() new_tileset_command(plugin) end }
  plugin:newMenuSeparator{ group = "cpcbuild_menu" }
  plugin:newCommand{ id = "CpcCheck", title = "Check for CPC...", group = "cpcbuild_menu",
                     onclick = check_command,
                     onenabled = function() return app.sprite ~= nil end }
  plugin:newCommand{ id = "CpcExport", title = "Export for CPCBuild...", group = "cpcbuild_menu",
                     onclick = function() export_command(plugin) end,
                     onenabled = function() return app.sprite ~= nil end }
end

function exit(plugin)
end
