import json

with open("eBook Ingestion.json", "r") as f:
    data = json.load(f)

# 1. Update Execute Command3 (Classification)
# Ensure it uses cp for PDF and fonts, and mv for pages.
for node in data["nodes"]:
    if node["name"] == "Execute Command3":
        node["parameters"]["command"] = """=# 1. Variables
TARGET_DIR="{{ JSON.parse($node[\"Execute Command1\"].json.stdout).targetDir }}"
TITLE="{{ $json[\"ChapterTitle\"] }}"
START={{ $json[\"StartPage\"] }}
END={{ $json[\"EndPage\"] }}

BOOK_PATH="$TARGET_DIR"
CHAPTER_PATH="$BOOK_PATH/$TITLE"

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

    # 2. Update Execute Command6 (Cleanup)
    # Use targetDir from Execute Command1
    elif node["name"] == "Execute Command6":
        node["parameters"]["command"] = """=# 1. Variables
TARGET_DIR="{{ JSON.parse($node[\"Execute Command1\"].json.stdout).targetDir }}"

# 2. Cleanup
if [ -d "$TARGET_DIR" ]; then
  # Delete only the PDF sitting in the root (not inside chapters)
  find "$TARGET_DIR" -maxdepth 1 \\( -name "*.pdf" -o -name "*.PDF" \\) -delete
fi

echo "{\\"status\\": \\"complete\\", \\"msg\\": \\"Root cleaned for $TARGET_DIR\\"}" """

    # 3. Update Merge Node
    elif node["name"] == "Merge":
        node["parameters"] = {
            "mode": "choose",
            "choice": "wait"
        }

# 4. Update Connections
# We need to re-route connections for the Merge node
# From: Get row(s) in sheet (Index 1) -> Merge
# To: Execute Command1 -> Merge (Index 0)
# To: Execute Command3 -> Merge (Index 1)

conns = data["connections"]

# Remove: Get row(s) in sheet -> Merge (Index 1)
if "Get row(s) in sheet" in conns:
    new_targets = []
    for target in conns["Get row(s) in sheet"]["main"][0]:
        if target["node"] == "Merge" and target["index"] == 1:
            continue
        new_targets.append(target)
    conns["Get row(s) in sheet"]["main"][0] = new_targets

# Add: Execute Command1 -> Merge (Index 0)
if "Execute Command1" in conns:
    # Ensure it's not already there
    already_exists = False
    for target in conns["Execute Command1"]["main"][0]:
        if target["node"] == "Merge" and target["index"] == 0:
            already_exists = True
            break
    if not already_exists:
        conns["Execute Command1"]["main"][0].append({"node": "Merge", "type": "main", "index": 0})

# Add: Execute Command3 -> Merge (Index 1)
if "Execute Command3" in conns:
    # Current connects to Merge index 0 (if I recall from previous view_file)
    # Let's fix it to index 1
    new_targets = []
    for target in conns["Execute Command3"]["main"][0]:
        if target["node"] == "Merge":
            new_targets.append({"node": "Merge", "type": "main", "index": 1})
        else:
            new_targets.append(target)
    conns["Execute Command3"]["main"][0] = new_targets

with open("eBook Ingestion.json", "w") as f:
    json.dump(data, f, indent=2)

print("Updated eBook Ingestion.json: Fixed coordination and cleanup.")
