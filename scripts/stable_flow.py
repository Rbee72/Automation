import json

with open("eBook Ingestion.json", "r") as f:
    data = json.load(f)

# 1. Update Execute Command3 (Classification) - Robust & Logging
for node in data["nodes"]:
    if node["name"] == "Execute Command3":
        node["parameters"]["command"] = """=# 1. Variables
T_DIR="{{ JSON.parse($node[\"Execute Command1\"].json.stdout).targetDir }}"
TITLE="{{ $json[\"ChapterTitle\"] }}"
START="{{ $json[\"StartPage\"] }}"
END="{{ $json[\"EndPage\"] }}"

# Log attempt
echo "Attempting Chapter: $TITLE (Pages $START to $END)"

# Clean inputs
START=$(echo "$START" | grep -oE '[0-9]+' | head -1)
END=$(echo "$END" | grep -oE '[0-9]+' | head -1)

if [ -z "$TITLE" ] || [ -z "$START" ] || [ -z "$END" ]; then
  echo "Error: Row missing data for $TITLE"
  exit 0 # Don't stop the whole flow
fi

BOOK_PATH="$T_DIR"
CHAPTER_PATH="$BOOK_PATH/$TITLE"

# 2. Create Chapter Folder
mkdir -p "$CHAPTER_PATH"

# 3. Move unique assets (HTML, JPG, Asset Folders)
for i in $(seq "$START" "$END"); do
  [ -f "$BOOK_PATH/$i.html" ] && mv "$BOOK_PATH/$i.html" "$CHAPTER_PATH/"
  [ -f "$BOOK_PATH/$i.jpg" ] && mv "$BOOK_PATH/$i.jpg" "$CHAPTER_PATH/"
  [ -d "$BOOK_PATH/$i" ] && mv "$BOOK_PATH/$i" "$CHAPTER_PATH/"
done

# 4. Handle Fonts (Copy)
[ -d "$BOOK_PATH/fonts" ] && cp -r "$BOOK_PATH/fonts" "$CHAPTER_PATH/"

# 5. Handle PDF (Copy)
PDF_FILE=$(find "$BOOK_PATH" -maxdepth 1 -name "*.pdf" -o -name "*.PDF" | head -1)
if [ ! -z "$PDF_FILE" ]; then
  cp "$PDF_FILE" "$CHAPTER_PATH/"
else
  echo "Warning: PDF not found in root for $TITLE"
fi

echo "{\\"status\\": \\"success\\", \\"chapter\\": \\"$TITLE\\"}" """

    # 2. Update Cleanup Node (Execute Command6) - Disable PDF deletion for now
    elif node["name"] == "Execute Command6":
        node["parameters"]["command"] = """=# Cleanup is currently set to NO-OP to prevent race conditions
echo '{"status": "skipped", "msg": "Cleanup skipped to ensure all chapters process"}' """

# 3. Fix Connections: Linear Path (Sheets -> Classify -> No Merge)
conns = data["connections"]

# Remove connections TO Merge and FROM Merge
for src in list(conns.keys()):
    filtered_targets = []
    for target_list in conns[src]["main"]:
        clean_target_list = [t for t in target_list if t["node"] != "Merge" and t["node"] != "Execute Command6"]
        filtered_targets.append(clean_target_list)
    conns[src]["main"] = filtered_targets

# Rebuild Connection: Execute Command3 -> NOTHING (It flows naturally)
# Rebuild Connection: Sheets -> Execute Command3
if "Get row(s) in sheet" in conns:
    conns["Get row(s) in sheet"]["main"] = [[{"node": "Execute Command3", "type": "main", "index": 0}]]

# Connect Cleanup node directly to Setup with a pulse IF needed, but let's keep it disconnected for now.
# We will rely on manual verification that all chapters moved.

with open("eBook Ingestion.json", "w") as f:
    json.dump(data, f, indent=2)

print("Workflow UPDATED: Linear classification, robust seq handling, and cleanup disabled.")
