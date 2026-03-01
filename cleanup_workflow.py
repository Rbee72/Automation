import json

with open("eBook Ingestion.json", "r") as f:
    data = json.load(f)

# Flow A Nodes (The ones we keep)
flow_a_names = [
    "Execute Command1",
    "When clicking \u201cExecute workflow\u201d",
    "Get row(s) in sheet",
    "Extract Thumbnails",
    "Execute Command3",
    "Execute Command6",
    "Merge",
    "Sticky Note",
    "Sticky Note1"
]

# 1. Filter nodes to keep only Flow A
data["nodes"] = [node for node in data["nodes"] if node["name"] in flow_a_names]

# 2. Update Google Sheets Node
for node in data["nodes"]:
    if node["name"] == "Get row(s) in sheet":
        # Force return all matches
        node["parameters"]["options"] = {"returnAll": True}
        # Double check filters use folderName.trim()
        node["parameters"]["filtersUI"]["values"][0]["lookupValue"] = "={{ JSON.parse($node[\"Execute Command1\"].json.stdout).folderName.trim() }}"

    # 3. Update Classification Node (Execute Command3) with logging
    elif node["name"] == "Execute Command3":
        node["parameters"]["command"] = """=# 1. Variables
T_DIR="{{ JSON.parse($node[\"Execute Command1\"].json.stdout).targetDir }}"
TITLE="{{ $json[\"ChapterTitle\"] }}"
START={{ $json[\"StartPage\"] }}
END={{ $json[\"EndPage\"] }}

[ -z "$TITLE" ] && echo '{"error": "Empty Title"}' && exit 1

BOOK_PATH="$T_DIR"
CHAPTER_PATH="$BOOK_PATH/$TITLE"

echo "Processing Chapter: $TITLE (Pages $START to $END)"

# 2. Create Chapter Folder
mkdir -p "$CHAPTER_PATH"

# 3. Move unique assets (HTML, JPG, Asset Folders)
if [ ! -z "$START" ] && [ ! -z "$END" ]; then
  for i in $(seq "$START" "$END"); do
    [ -f "$BOOK_PATH/$i.html" ] && mv "$BOOK_PATH/$i.html" "$CHAPTER_PATH/"
    [ -f "$BOOK_PATH/$i.jpg" ] && mv "$BOOK_PATH/$i.jpg" "$CHAPTER_PATH/"
    [ -d "$BOOK_PATH/$i" ] && mv "$BOOK_PATH/$i" "$CHAPTER_PATH/"
  done
fi

# 4. Handle Fonts (Copy, don't move)
[ -d "$BOOK_PATH/fonts" ] && cp -r "$BOOK_PATH/fonts" "$CHAPTER_PATH/"

# 5. Handle PDF (Copy, don't move)
PDF_FILE=$(find "$BOOK_PATH" -maxdepth 1 -name "*.pdf" -o -name "*.PDF" | head -1)
[ ! -z "$PDF_FILE" ] && cp "$PDF_FILE" "$CHAPTER_PATH/"

echo "{\\"status\\": \\"success\\", \\"chapter\\": \\"$TITLE\\"}" """

# 4. Cleanup Connections (Only keep ones between Flow A nodes)
new_conns = {}
for source_node, targets in data["connections"].items():
    if source_node in flow_a_names:
        valid_targets_list = []
        for target_list in targets["main"]:
            valid_targets = [t for t in target_list if t["node"] in flow_a_names]
            valid_targets_list.append(valid_targets)
        new_conns[source_node] = {"main": valid_targets_list}
data["connections"] = new_conns

with open("eBook Ingestion.json", "w") as f:
    json.dump(data, f, indent=2)

print("Simplified eBook Ingestion.json: Removed Flow B and fixed Multi-Chapter lookup.")
