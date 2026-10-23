-- headless.lua -- drives cpcbuild_core.lua from `aseprite -b --script` so the
-- extension's logic can be tested without dialogs (tests/tools/test_aseprite.py).
-- MIT licensed, like the rest of cpcbuild.
--
--   aseprite -b --script-param action=new_sprite --script-param mode=0 \
--     --script-param w=16 --script-param h=16 --script-param frames=4 \
--     --script-param masked=0 --script-param name=hero \
--     --script-param tags=walk:1-4 --script-param out=hero.aseprite \
--     --script headless.lua
--
-- Actions (parameters are app.params):
--   new_sprite  mode w h frames masked name [tags=name:from-to,...] out
--   new_tiles   mode tw [mw mh] name out         (mw x mh = map size in tiles, default a full screen)
--   draw        file px=frame:x:y:index,...        (sprites; index = palette index)
--   draw_tiles  file px=x1:y1:x2:y2:index,...      (pencil strokes on the tilemap layer; the
--                                                  first stroke must cover the area to be used)
--   set_color   file index=r,g,b                   (change a palette entry)
--   size        file                               (prints the canvas size WxH)
--   plugin_init                                    (runs the extension's init() with a stand-in
--                                                  plugin and lists the commands it registers)
--   check       file                               (prints the report)
--   export      file dir [tmx=1] [force=1]         (prints the files written, and the project
--                                                  recipe if dir is inside a CPCBuild project)
-- Every action prints lines starting "RESULT " that the tests read.

local here = debug.getinfo(1, "S").source:sub(2):match("^(.*)/[^/]*$") or "."
local cpc = dofile(here .. "/extension/cpcbuild_core.lua")
local P = app.params

local function fail(msg)
  print("RESULT error " .. tostring(msg))
  error(msg)
end

local function save(sprite, out)
  sprite:saveAs(out)
  print("RESULT saved " .. out)
end

local function open(file)
  local s = Sprite{ fromFile = file }
  if s == nil then fail("cannot open " .. file) end
  app.sprite = s
  return s
end

local action = P.action
if action == "new_sprite" then
  local s, err = cpc.new_sprite{ mode = tonumber(P.mode), w = tonumber(P.w), h = tonumber(P.h),
                                 frames = tonumber(P.frames), masked = P.masked == "1", name = P.name }
  if not s then fail(err) end
  for spec in (P.tags or ""):gmatch("[^,]+") do
    local name, a, b = spec:match("^(.-):(%d+)-(%d+)$")
    s:newTag(tonumber(a), tonumber(b)).name = name
  end
  save(s, P.out)

elseif action == "new_tiles" then
  local s, err = cpc.new_tileset{ mode = tonumber(P.mode), tw = tonumber(P.tw),
                                  mapw = tonumber(P.mw), maph = tonumber(P.mh), name = P.name }
  if not s then fail(err) end
  save(s, P.out)

elseif action == "draw" then
  local s = open(P.file)
  for f, x, y, i in (P.px or ""):gmatch("(%d+):(%d+):(%d+):(%d+)") do
    local cel = s.layers[1]:cel(tonumber(f))
    if cel == nil then
      local img = Image(ImageSpec{ width = s.width, height = s.height, colorMode = ColorMode.INDEXED,
                                   transparentColor = s.transparentColor })
      img:clear(s.transparentColor)
      cel = s:newCel(s.layers[1], tonumber(f), img, Point(0, 0))
    end
    cel.image:drawPixel(tonumber(x), tonumber(y), tonumber(i))
  end
  save(s, P.file)

elseif action == "draw_tiles" then
  local s = open(P.file)
  local layer = s.layers[1]
  app.layer = layer
  for x1, y1, x2, y2, i in (P.px or ""):gmatch("(%d+):(%d+):(%d+):(%d+):(%d+)") do
    app.useTool{ tool = "pencil", color = tonumber(i),
                 points = { Point(tonumber(x1), tonumber(y1)), Point(tonumber(x2), tonumber(y2)) },
                 layer = layer, frame = s.frames[1] }
  end
  print("RESULT tiles " .. #layer.tileset)
  save(s, P.file)

elseif action == "set_color" then
  local s = open(P.file)
  local i, r, g, b = P.index:match("^(%d+)=(%d+),(%d+),(%d+)$")
  local pal = Palette(s.palettes[1])
  pal:setColor(tonumber(i), Color{ r = tonumber(r), g = tonumber(g), b = tonumber(b) })
  s:setPalette(pal)
  save(s, P.file)

elseif action == "size" then
  local s = open(P.file)
  print("RESULT size " .. s.width .. "x" .. s.height)

elseif action == "plugin_init" then
  dofile(here .. "/extension/cpcbuild.lua")
  local mock = { path = here .. "/extension", preferences = {} }
  function mock:newMenuGroup(t) print("RESULT group " .. t.id .. " in " .. t.group) end
  function mock:newMenuSeparator(t) print("RESULT separator in " .. t.group) end
  function mock:newCommand(t)
    assert(type(t.onclick) == "function", t.id .. " has no onclick")
    print("RESULT command " .. t.id .. " in " .. t.group .. ": " .. t.title)
  end
  init(mock)
  exit(mock)

elseif action == "check" then
  local s = open(P.file)
  local rep = cpc.check(s)
  for _, k in ipairs{ "errors", "warnings", "info" } do
    for _, line in ipairs(rep[k]) do print("RESULT " .. k .. " " .. line) end
  end

elseif action == "export" then
  local s = open(P.file)
  local r, err = cpc.export(s, { dir = P.dir, tmx = P.tmx == "1", force = P.force == "1" })
  if not r then fail(err) end
  for _, f in ipairs(r.files) do print("RESULT file " .. f) end
  local pr = r.project
  if pr then
    print(string.format("RESULT project %s|%s|%s|%s", pr.name, pr.recipe, pr.created and "created" or "kept",
                        pr.matched and "matched" or "unmatched"))
  end
  print(string.format("RESULT sheet %dx%d cols=%d count=%d", r.sheet.w, r.sheet.h, r.sheet.cols, r.sheet.count))

else
  fail("unknown action " .. tostring(action))
end
