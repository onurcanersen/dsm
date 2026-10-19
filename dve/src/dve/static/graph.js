/* The two pictures of a Model Setup Data file on a vendored AntV G6 canvas:
 * the software view, a tree CSMS > CSS > CSCI > CSC > CSU with one relation
 * card per CSU (SRS DSM-SMM req 6, 7), and the hardware view, the networks
 * as bus lines with their nodes beneath. app.js drives both through
 * window.DsmHierarchyGraph; the search panel finds, opens, centres and
 * lights a box, row or bus (SRS DSM-DVE req 43). */
(function () {
  "use strict";

  // The vendored G6 build asks for Object.hasOwn behind a feature check;
  // Firefox 90 has none, so an equivalent is supplied before the check.
  if (typeof Object.hasOwn !== "function") {
    Object.defineProperty(Object, "hasOwn", {
      configurable: true,
      writable: true,
      value: function hasOwn(object, key) {
        if (object === null || object === undefined) {
          throw new TypeError("Cannot convert undefined or null to object");
        }
        return Object.prototype.hasOwnProperty.call(Object(object), key);
      }
    });
  }

  // What the writer leaves where a source had nothing to give.
  var MISSING = "NOT_FOUND";

  var COLOR = {
    cyan: "#22e6f5",
    line: "rgba(34, 230, 245, 0.55)"
  };

  // The containment levels above a CSU, top down (SRS DSM-SMM req 6): the
  // hierarchy field naming each and the tag its box carries.
  var LEVELS = [
    { key: "csms", field: "csms_name", tag: "CSMS" },
    { key: "css", field: "css_name", tag: "CSS" },
    { key: "csci", field: "csci_name", tag: "CSCI" },
    { key: "csc", field: "csc_name", tag: "CSC" }
  ];

  // The relation cards under a CSU (SRS DSM-SMM req 7): the relationships
  // key, the card label, the kind listed and the graph list holding it.
  var GROUPS = [
    { key: "runs_on", label: "RUNS ON", kind: "node", list: "nodes" },
    { key: "publishes_to", label: "PUB TO", kind: "topic", list: "topics" },
    { key: "subscribes_to", label: "SUB TO", kind: "topic", list: "topics" },
    { key: "sends", label: "SENDS", kind: "message", list: "messages" },
    { key: "receives", label: "RECEIVES", kind: "message", list: "messages" },
    { key: "uses", label: "USES", kind: "lib", list: "libraries" }
  ];

  var KIND_NAMES = { app: "CSU", node: "Node", topic: "Topic", message: "Message", lib: "Library", network: "Network" };

  // el.graph is the container app.js hands over; el.rowTip the hover card of the rows.
  var el = {};
  var graph = null;
  // The tree last built: its G6 data, the cards per entity id and the search index.
  var tree = null;
  // The model last loaded, for Collapse all to rebuild from.
  var lastModel = null;
  // The search's one lit target { nodeId, ref } (req 43), ref null for a box
  // alone; rowsHtml reads it so a re-render keeps the row lit.
  var lit = null;
  // Expansions queue on this promise, since G6 drops an expandElement call
  // while another is in flight.
  var pending = Promise.resolve();
  // Which picture is drawn: "sw" the system hierarchy tree, "hw" the
  // networks with their nodes (see the hardware section).
  var mode = "sw";
  // The hardware view's open buses by id: the grid shows the cards on them.
  var openBuses = {};

  /* ---------------------------------------------------------------- tree */

  function indexById(list) {
    var index = {};
    (list || []).forEach(function (item) {
      index[item.id] = item;
    });
    return index;
  }

  function shown(value) {
    return value === undefined || value === null || value === "" || value === MISSING ? "—" : String(value);
  }

  function compareText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function byLabel(a, b) {
    return compareText(a.data.label, b.data.label);
  }

  // The file's graph as G6 tree data (SRS DSM-SMM req 6, 7), open on the top
  // two levels; `open` starts every level above the units open instead.
  function buildTree(msd, open) {
    var g = msd.graph || {};
    var entities = {
      node: indexById(g.nodes),
      topic: indexById(g.topics),
      message: indexById(g.messages),
      lib: indexById(g.libraries)
    };
    var relationships = g.relationships || {};

    // Per application id, per relation key, the target ids.
    var targets = {};
    GROUPS.forEach(function (group) {
      (relationships[group.key] || []).forEach(function (edge) {
        var bucket = targets[edge.from] || (targets[edge.from] = {});
        (bucket[group.key] || (bucket[group.key] = [])).push(edge.to);
      });
    });

    var copies = {};
    var roots = [];
    var index = {};
    // For the search (req 43): each box's parent and label for a result's
    // path, the entries to match, and the first row seen per entity.
    var parents = {};
    var labels = {};
    var entries = [];
    var seen = {};

    function ensure(siblings, id, make) {
      if (!index[id]) {
        index[id] = make();
        siblings.push(index[id]);
      }
      return index[id];
    }

    (g.applications || []).forEach(function (app) {
      var hierarchy = app.system_hierarchy || {};
      var siblings = roots;
      var path = "";
      var parentId = null;
      LEVELS.forEach(function (level) {
        var name = hierarchy[level.field];
        if (!name || name === MISSING) {
          name = "Unassigned";
        }
        path += (path ? "/" : "") + name;
        var id = level.key + ":" + path;
        var node = ensure(siblings, id, function () {
          var made = { id: id, data: { level: level.key, tag: level.tag, label: name, count: 0 }, children: [] };
          // Every level under the system starts closed, unless opening all.
          if (level.key !== "csms") {
            made.style = { collapsed: !open };
          }
          parents[id] = parentId;
          labels[id] = name;
          entries.push({ type: "hierarchy", tag: level.tag, glyph: GLYPHS[level.key], id: id, label: name, text: name.toLowerCase() });
          return made;
        });
        node.data.count += 1;
        siblings = node.children;
        parentId = id;
      });

      var csu = {
        id: app.id,
        data: { level: "csu", tag: "CSU", kind: "app", ref: app.id, label: app.name, attrs: app },
        style: { collapsed: true },
        children: []
      };
      GROUPS.forEach(function (group) {
        var ids = (targets[app.id] || {})[group.key] || [];
        if (!ids.length) {
          return;
        }
        var groupNode = {
          id: app.id + "/" + group.key,
          data: { level: "group", label: group.label, kind: group.kind, count: ids.length, items: [] }
        };
        groupNode.data.items = ids.map(function (targetId) {
          var entity = entities[group.kind][targetId];
          (copies[targetId] || (copies[targetId] = [])).push(groupNode.id);
          var label = entity ? entity.name : targetId;
          if (!seen[targetId]) {
            seen[targetId] = { kind: group.kind, label: label };
          }
          return { ref: targetId, kind: group.kind, label: label, attrs: entity || {} };
        });
        parents[groupNode.id] = app.id;
        labels[groupNode.id] = group.label;
        // "pub", "pub to", "publishes to" and "runs on" all find the card.
        entries.push({
          type: "relation",
          tag: "Relation",
          glyph: GLYPHS[group.kind],
          id: groupNode.id,
          label: group.label,
          text: (group.label + " " + group.key.replace(/_/g, " ")).toLowerCase()
        });
        groupNode.data.items.sort(function (a, b) {
          return compareText(a.label, b.label);
        });
        csu.children.push(groupNode);
      });
      siblings.push(csu);
      (copies[app.id] || (copies[app.id] = [])).push(app.id);
      parents[app.id] = parentId;
      labels[app.id] = app.name;
      entries.push({ type: "csu", tag: "CSU", glyph: GLYPHS.csu, id: app.id, label: String(app.name), text: String(app.name).toLowerCase() });
    });

    // One search entry per entity with the cards listing it (req 43); an
    // entity used by no CSU is on no card, so it is off the tree.
    Object.keys(seen).forEach(function (ref) {
      var first = seen[ref];
      var cards = copies[ref].filter(function (id) {
        return id.indexOf("/") !== -1;
      });
      entries.push({
        type: first.kind,
        tag: KIND_NAMES[first.kind] || first.kind,
        glyph: GLYPHS[first.kind],
        ref: ref,
        label: String(first.label),
        text: String(first.label).toLowerCase(),
        copies: cards
      });
    });

    Object.keys(index).forEach(function (id) {
      index[id].children.sort(byLabel);
    });

    var root = roots.length === 1 ? roots[0] : { id: "root", data: { level: "root", tag: "DSM", label: "Systems" }, children: roots };
    if (roots.length > 1) {
      labels.root = "Systems";
      roots.forEach(function (top) {
        parents[top.id] = "root";
      });
    }
    var data = G6.treeToGraphData(root, {
      getEdgeData: function (source, target) {
        return { id: source.id + "->" + target.id, source: source.id, target: target.id };
      }
    });
    return { data: data, copies: copies, entities: entities, parents: parents, labels: labels, index: entries };
  }

  /* ------------------------------------------------------------ hardware */

  /* The hardware view: every network a horizontal bus line, one under the
   * other, each with a [+]/[-] toggle. The cards on the open buses form a
   * grid above the lines, left to right in group order, as many to a row as
   * the stage is wide, each group opening under a cluster label, and from
   * each card one straight tap down to every open bus it is on (the port
   * names stay in the hover card). Each node is drawn once. Positions are
   * computed here, so the graph runs with no layout. */

  var CONTENT_X = 24; // from the lines' start to the first card
  var LABEL_H = 20; // the cluster label's room above a group's first card
  var WRAP_GAP = 44; // between rows of cards, room for a cluster label
  var GRID_GAP = 56; // under the last row of cards, before the first bus
  var LINE_Y = 24; // the line's offset from the top of the bus node; the name sits above it
  var BUS_PITCH = 52; // from one bus line to the next
  var END_PAD = 40; // the lines' run past the last card
  var MIN_RUN = 160; // the shortest line
  // The lines are drawn across the visible stage, this far in from its
  // sides, whatever the zoom or pan (stretchLines); lineSpan holds the
  // current span in canvas units for the bus markup.
  var VIEW_MARGIN = 24;
  var lineSpan = null;

  function hardwareIndex(msd) {
    var g = msd.graph || {};
    var nodes = indexById(g.nodes);
    var networks = indexById(g.networks);
    var relationships = g.relationships || {};
    var members = {};
    var homes = {};
    var units = {};
    (relationships.connects_to || []).forEach(function (link) {
      // A node on a network, as the writer emits it; anything else is skipped.
      if (nodes[link.from] && networks[link.to]) {
        (members[link.to] || (members[link.to] = [])).push({ node: link.from, device: link.device, dev_raw: link.dev_raw });
        (homes[link.from] || (homes[link.from] = [])).push({ network: link.to, device: link.device, dev_raw: link.dev_raw });
      }
    });
    (relationships.runs_on || []).forEach(function (edge) {
      units[edge.to] = (units[edge.to] || 0) + 1;
    });
    return { nodes: nodes, networks: networks, members: members, homes: homes, units: units };
  }

  function groupOf(node) {
    var group = (node || {}).group;
    return !group || group === MISSING ? "" : String(group);
  }

  // A node's tap in words: the network's name, and the device in brackets when known.
  function linkLabel(link) {
    return link.name + (link.device && link.device !== MISSING ? " (" + link.device + ")" : "");
  }

  // A node's search entry; its path lists the networks it taps.
  function nodeEntry(nodeId, node, links) {
    return {
      type: "node",
      tag: "Node",
      glyph: GLYPHS.node,
      id: nodeId,
      label: String(node.name),
      text: String(node.name).toLowerCase(),
      path: links.map(linkLabel).join(" \u00b7 ")
    };
  }

  // The buses top to bottom: the fullest first (the shortest taps), the
  // empty ones last, names breaking ties.
  function orderBuses(index) {
    return Object.keys(index.networks).sort(function (a, b) {
      return (index.members[b] || []).length - (index.members[a] || []).length || compareText(index.networks[a].name, index.networks[b].name);
    });
  }

  // The bus open when the picture is first drawn: the first one with nodes.
  function defaultOpen(msd) {
    var index = hardwareIndex(msd);
    var first = orderBuses(index)[0];
    var open = {};
    if (first && (index.members[first] || []).length) {
      open[first] = true;
    }
    return open;
  }

  // The hardware picture as G6 graph data with positions set (see above),
  // showing the cards on the buses in `open`.
  function buildHardware(msd, open) {
    var index = hardwareIndex(msd);
    var labels = {};
    var entries = [];
    var nodes = [];
    var edges = [];
    open = open || {};

    // The cards on an open bus, in group order and by name within a group.
    var cardIds = Object.keys(index.nodes)
      .filter(function (id) {
        return (index.homes[id] || []).some(function (link) {
          return open[link.network];
        });
      })
      .sort(function (a, b) {
        return compareText(groupOf(index.nodes[a]), groupOf(index.nodes[b])) || compareText(index.nodes[a].name, index.nodes[b].name);
      });
    var busIds = orderBuses(index);

    // A tap with its network's name in place of the id.
    function namedLink(link) {
      return { name: (index.networks[link.network] || {}).name || link.network, device: link.device, dev_raw: link.dev_raw };
    }

    // One port per tap on each bus: { key, ax }.
    var busPorts = {};
    busIds.forEach(function (id) {
      busPorts[id] = [];
    });

    // The lines' content run: the stage's width at zoom 1, at least MIN_RUN;
    // a row of cards also ends where it would pass the run's end.
    var run = Math.max(MIN_RUN, (el.graph ? el.graph.clientWidth : 0) - PADDING_HW[1] - PADDING_HW[3]);
    var wrapRight = run - END_PAD;

    var x = CONTENT_X;
    var right = CONTENT_X;
    var cardTop = LABEL_H;
    var inRow = 0;
    var lastGroup = null;
    cardIds.forEach(function (nodeId) {
      var node = index.nodes[nodeId];
      // Its taps: to the open buses only.
      var links = (index.homes[nodeId] || [])
        .filter(function (link) {
          return open[link.network];
        })
        .sort(function (a, b) {
          return busIds.indexOf(a.network) - busIds.indexOf(b.network);
        });
      var datum = {
        id: nodeId,
        data: {
          level: "node",
          tag: "Node",
          kind: "node",
          ref: nodeId,
          label: node.name,
          attrs: node,
          units: index.units[nodeId] || 0,
          networks: links.map(namedLink),
          ports: links.map(function (link, i) {
            return { key: "tap" + i, placement: [(i + 1) / (links.length + 1), 1] };
          })
        }
      };
      var width = widthOf(datum);
      if (inRow > 0 && x + width > wrapRight) {
        inRow = 0;
        x = CONTENT_X;
        cardTop += BOX_HEIGHT + WRAP_GAP;
      }
      inRow += 1;
      var group = groupOf(node);
      if (group !== lastGroup) {
        // The cluster label over the group's first card.
        lastGroup = group;
        var text = group || "ungrouped";
        var labelW = Math.ceil(textWidth("sub", text.toUpperCase()) + 8);
        nodes.push({
          id: "glabel:" + nodeId,
          data: { level: "glabel", label: text, w: labelW, h: LABEL_H - 4 },
          style: { x: x + labelW / 2, y: cardTop - LABEL_H / 2 - 2 }
        });
      }
      datum.style = { x: x + width / 2, y: cardTop + BOX_HEIGHT / 2 };
      nodes.push(datum);
      links.forEach(function (link, i) {
        var ax = x + width * ((i + 1) / (links.length + 1));
        var key = "tap:" + nodeId + ":" + i;
        busPorts[link.network].push({ key: key, ax: ax });
        edges.push({
          id: key,
          source: nodeId,
          target: link.network,
          data: {
            edge: "tap",
            sourcePort: "tap" + i,
            targetPort: key,
            device: link.device,
            dev_raw: link.dev_raw,
            from: node.name,
            to: (index.networks[link.network] || {}).name
          }
        });
      });
      x += width + H_GAP;
      right = Math.max(right, x - H_GAP);
      labels[nodeId] = node.name;
      entries.push(nodeEntry(nodeId, node, datum.data.networks));
    });

    // Every node is findable, shown or not: the search opens its buses.
    Object.keys(index.nodes).forEach(function (nodeId) {
      if (cardIds.indexOf(nodeId) !== -1) {
        return;
      }
      var node = index.nodes[nodeId];
      labels[nodeId] = node.name;
      entries.push(nodeEntry(nodeId, node, (index.homes[nodeId] || []).map(namedLink)));
    });

    // The buses under the grid, one line under the other, each the content
    // run long: the stage's width less its side paddings, so the lines keep
    // clear of both edges.
    run = Math.max(run, right + END_PAD);
    var busW = run;
    var busH = LINE_Y + 12;
    var busTop = cardIds.length ? cardTop + BOX_HEIGHT + GRID_GAP : 0;
    busIds.forEach(function (busId) {
      var network = index.networks[busId];
      var count = (index.members[busId] || []).length;
      nodes.push({
        id: busId,
        data: {
          level: "bus",
          tag: "Network",
          kind: "network",
          label: network.name,
          attrs: network,
          empty: !count,
          open: !!open[busId],
          w: busW,
          h: busH,
          run: run,
          lineY: LINE_Y,
          count: count,
          ports: busPorts[busId].map(function (port) {
            return { key: port.key, placement: [port.ax / busW, LINE_Y / busH] };
          })
        },
        style: { x: run / 2, y: busTop + busH / 2 }
      });
      labels[busId] = network.name;
      entries.push({
        type: "network",
        tag: "Network",
        glyph: GLYPHS.bus,
        id: busId,
        label: String(network.name),
        text: String(network.name).toLowerCase(),
        path: shown(network.purpose)
      });
      busTop += BUS_PITCH;
    });

    return {
      data: { nodes: nodes, edges: edges },
      copies: {},
      entities: { node: index.nodes, network: index.networks },
      homes: index.homes,
      parents: {},
      labels: labels,
      index: entries
    };
  }

  /* -------------------------------------------------------------- styling */

  /* Every box is the same card: a glyph on the left, a title over a muted
   * subtitle, and a bracketed [+]/[-] on the right when it can open. */

  var BOX_HEIGHT = 44;

  // The rows of a relation card: row height, bottom padding, and how many
  // rows the card shows at once; longer lists scroll inside the card.
  var ROW_HEIGHT = 26;
  var LIST_PAD = 6;
  var LIST_CAP = 8;


  // The lucide glyph (static/fonts) each kind of box carries; a relation
  // card wears the glyph of what it lists.
  var GLYPHS = {
    root: "lucide-ship",
    csms: "lucide-ship",
    css: "lucide-layers",
    csci: "lucide-boxes",
    csc: "lucide-box",
    csu: "lucide-cpu",
    node: "lucide-server",
    topic: "lucide-radio",
    message: "lucide-mail",
    lib: "lucide-library",
    bus: "lucide-network"
  };

  var GROUP_SUBTITLES = { "RUNS ON": "Nodes", "PUB TO": "Topics", "SUB TO": "Topics", SENDS: "Messages", RECEIVES: "Messages", USES: "Libraries" };

  function childCount(datum) {
    return (datum.children || []).length;
  }

  function hasChildren(datum) {
    return childCount(datum) > 0;
  }

  function plural(count, word) {
    return count + " " + word + (count === 1 ? "" : "s");
  }

  // What one level down is called, for the count a card shows.
  var CHILD_NAMES = { root: "CSMS", csms: "CSS", css: "CSCI", csci: "CSC", csc: "CSU" };

  // The second line of the card: what the box is, and for the hierarchy
  // levels how many boxes sit directly below it.
  function subtitleOf(datum) {
    var data = datum.data || {};
    var attrs = data.attrs || {};
    switch (data.level) {
      case "root":
      case "csms":
      case "css":
      case "csci":
      case "csc":
        return (data.tag || "DSM") + " · " + plural(childCount(datum), CHILD_NAMES[data.level]);
      case "csu":
        return "CSU · v" + shown(attrs.version);
      case "node":
        // The group and how many software units run on the node; the
        // hardware stays in the hover card.
        return shown(attrs.group) + " · " + plural(data.units || 0, "CSU");
      case "group":
        return (GROUP_SUBTITLES[data.label] || "Relation") + " · " + data.count;
      default:
        return "";
    }
  }

  function titleOf(datum) {
    var data = datum.data || {};
    return String(data.label || datum.id);
  }

  // A relation card wears the glyph of what it points at.
  function glyphOf(datum) {
    var data = datum.data || {};
    return GLYPHS[data.level === "group" ? data.kind : data.level] || "lucide-box-select";
  }

  // A relation card is the header plus up to LIST_CAP rows; the rest scroll.
  function heightOf(datum) {
    var data = datum.data || {};
    if (data.level === "bus" || data.level === "glabel") {
      return data.h;
    }
    if (data.level !== "group") {
      return BOX_HEIGHT;
    }
    return BOX_HEIGHT + Math.min((data.items || []).length, LIST_CAP) * ROW_HEIGHT + LIST_PAD;
  }

  /* Card widths come from measuring the real text on an offscreen canvas,
   * once per font and string. The fonts and paddings mirror the box rules
   * of app.css; letter-spacing is added by hand since measureText ignores it. */

  var FONTS = {
    title: { font: "600 13px Barlow, sans-serif", spacing: 0.13 },
    sub: { font: "10px Barlow, sans-serif", spacing: 0.3 },
    row: { font: "11.5px Barlow, sans-serif", spacing: 0.23 },
    toggle: { font: "12px Barlow, sans-serif", spacing: 0 }
  };

  // From the box rules of app.css: the card border, the header's paddings, glyph and gaps,
  // the rows' margins and paddings, and the scrollbar beside long lists.
  var CARD_BORDER = 2;
  var HEAD_PAD = { left: 11, right: 10, gap: 10, glyph: 20 };
  var ROW_PAD = { margin: 4, side: 10, scrollbar: 12 };
  // Cards never grow past MAX_WIDTH; text that would not fit is cut with an
  // ellipsis and carries the full name as a hover title.
  var MIN_WIDTH = 140;
  var MAX_WIDTH = 240;

  var measurer = null;
  var measured = {};

  function textWidth(kind, text) {
    var key = kind + "\u0000" + text;
    if (measured[key] === undefined) {
      if (!measurer) {
        measurer = document.createElement("canvas").getContext("2d");
      }
      var spec = FONTS[kind];
      measurer.font = spec.font;
      measured[key] = measurer.measureText(text).width + text.length * spec.spacing;
    }
    return measured[key];
  }

  // The card width a header takes beyond its text, and the same for a row.
  function headExtra(datum) {
    var extra = CARD_BORDER * 2 + HEAD_PAD.left + HEAD_PAD.glyph + HEAD_PAD.gap + HEAD_PAD.right;
    return hasChildren(datum) ? extra + HEAD_PAD.gap + textWidth("toggle", "[\u2212]") : extra;
  }

  function rowExtra(datum) {
    var items = (datum.data || {}).items || [];
    return CARD_BORDER * 2 + (ROW_PAD.margin + ROW_PAD.side) * 2 + (items.length > LIST_CAP ? ROW_PAD.scrollbar : 0);
  }

  // Whether a title will be cut at MAX_WIDTH.
  function titleCut(datum) {
    return headExtra(datum) + textWidth("title", titleOf(datum)) + 3 > MAX_WIDTH;
  }

  function widthOf(datum) {
    var data = datum.data || {};
    if (data.level === "bus" || data.level === "glabel") {
      return data.w;
    }
    var lines = Math.max(textWidth("title", titleOf(datum)), textWidth("sub", "[" + subtitleOf(datum) + "]"));
    var width = headExtra(datum) + lines;
    if (data.level === "group") {
      var extra = rowExtra(datum);
      (data.items || []).forEach(function (item) {
        width = Math.max(width, extra + textWidth("row", String(item.label)));
      });
    }
    // Slack for sub-pixel rounding and the title's synthetic bold, which lands
    // about a pixel wider than measured since Barlow ships at 400 only.
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.ceil(width) + 3));
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  // The classes a box wears for its G6 states: lit by the pointer (active),
  // lit by the search (highlight), or both.
  function modifiersOf(datum) {
    var states = datum.states || [];
    var classes = [];
    if (states.indexOf("active") !== -1) {
      classes.push("box--active");
    }
    if (states.indexOf("highlight") !== -1) {
      classes.push("box--highlight");
    }
    return classes.join(" ");
  }

  // The card's markup; every string from the file passes through escapeHtml.
  // data-id is the handle the search uses to find the drawn card.
  function boxHtml(datum, modifier) {
    var data = datum.data || {};
    var classes = "box box--" + data.level + (modifier ? " " + modifier : "");
    var toggle = hasChildren(datum) ? '<span class="box__toggle">[' + (G6.isCollapsed(datum) ? "+" : "−") + "]</span>" : "";
    return (
      '<div class="' + classes + '" data-id="' + escapeHtml(datum.id) + '">' +
      '<div class="box__head">' +
      '<i class="box__glyph lucide ' + glyphOf(datum) + '"></i>' +
      '<span class="box__text">' +
      '<span class="box__title"' + (titleCut(datum) ? ' title="' + escapeHtml(titleOf(datum)) + '"' : "") + ">" + escapeHtml(titleOf(datum)) + "</span>" +
      '<span class="box__sub">' + escapeHtml(subtitleOf(datum)) + "</span>" +
      "</span>" +
      toggle +
      "</div>" +
      (data.level === "group" ? rowsHtml(datum) : "") +
      "</div>"
    );
  }

  // The rows of a relation card: its targets, scrolling past LIST_CAP of them.
  function rowsHtml(datum) {
    var data = datum.data || {};
    var items = data.items || [];
    var rows = items.map(function (item) {
      var isLit = !!(lit && lit.ref !== null && lit.nodeId === datum.id && lit.ref === item.ref);
      return (
        '<div class="list__row' + (isLit ? " list__row--highlight" : "") + '" data-ref="' + escapeHtml(item.ref) + '" data-kind="' + escapeHtml(item.kind) + '">' +
        '<span class="list__label">' + escapeHtml(item.label) + "</span>" +
        "</div>"
      );
    });
    return '<div class="list' + (items.length > LIST_CAP ? " list--scroll" : "") + '">' + rows.join("") + "</div>";
  }

  // A bus of the hardware view: the network's name over the left end of the
  // line with its node count and fold toggle, and the line across the stage
  // (the purpose stays in the hover card). The box modifiers become bus ones.
  function busHtml(datum, modifier) {
    var data = datum.data || {};
    var classes = "bus" + (data.empty ? " bus--empty" : "") + (modifier ? " " + modifier.replace(/box--/g, "bus--") : "");
    return (
      '<div class="' + classes + '" data-id="' + escapeHtml(datum.id) + '">' +
      '<div class="bus__label" style="height:' + (data.lineY - 4) + 'px">' +
      '<span class="bus__name">' + escapeHtml(data.label) + "</span>" +
      '<span class="bus__count">' + plural(data.count || 0, "node") + "</span>" +
      (data.count ? '<span class="bus__toggle">[' + (data.open ? "\u2212" : "+") + "]</span>" : "") +
      "</div>" +
      '<div class="bus__line" style="' + lineStyle() + "top:" + (data.lineY - 5) + 'px"></div>' +
      "</div>"
    );
  }

  // Where a bus line runs, in the bus node's own units: the current span of
  // the visible stage when known, the node's width otherwise.
  function lineStyle() {
    return lineSpan ? "left:" + lineSpan.left + "px;width:" + lineSpan.width + "px;right:auto;" : "left:0;";
  }

  // Stretches every bus line across the visible stage, VIEW_MARGIN in from
  // each side, in place: the DOM lines now, and lineSpan for the next draw.
  function stretchLines() {
    if (!graph || mode !== "hw" || !el.graph) {
      return;
    }
    var size = graph.getSize();
    var left = graph.getCanvasByViewport([VIEW_MARGIN, 0])[0];
    var right = graph.getCanvasByViewport([size[0] - VIEW_MARGIN, 0])[0];
    lineSpan = { left: left, width: Math.max(0, right - left) };
    Array.prototype.forEach.call(el.graph.querySelectorAll(".bus__line"), function (line) {
      line.style.left = lineSpan.left + "px";
      line.style.width = lineSpan.width + "px";
      line.style.right = "auto";
    });
  }

  var stretchQueued = false;

  function queueStretch() {
    if (stretchQueued) {
      return;
    }
    stretchQueued = true;
    requestAnimationFrame(function () {
      stretchQueued = false;
      stretchLines();
    });
  }

  // A cluster label of the hardware view's grid: text alone, no states.
  function labelHtml(datum) {
    return '<div class="glabel">' + escapeHtml((datum.data || {}).label) + "</div>";
  }

  function htmlOf(datum, modifier) {
    var level = (datum.data || {}).level;
    return level === "bus" ? busHtml(datum, modifier) : level === "glabel" ? labelHtml(datum) : boxHtml(datum, modifier);
  }

  function nodeStyle(datum) {
    var data = datum.data || {};
    var width = widthOf(datum);
    var height = heightOf(datum);
    return {
      size: [width, height],
      // An HTML node hangs from its top-left corner; pull it onto its centre
      // so the layout's positions and the ports agree with the drawn card.
      dx: -width / 2,
      dy: -height / 2,
      innerHTML: htmlOf(datum, ""),
      label: false,
      port: false,
      // The hardware view sets each node's ports where its lines attach.
      ports: data.ports || [
        { key: "in", placement: "top" },
        { key: "out", placement: "bottom" },
        { key: "left", placement: "left" },
        { key: "tail", placement: [TAIL / width, 1] }
      ],
      cursor: data.level === "bus" || data.level === "glabel" ? "default" : hasChildren(datum) || data.ref ? "pointer" : "default",
      // A bus is mostly empty space over the lines: only its label, line and
      // cluster names take the pointer (see .bus in app.css); a cluster label
      // takes none.
      pointerEvents: data.level === "bus" || data.level === "glabel" ? "none" : "auto"
    };
  }

  /* --------------------------------------------------------------- layout */

  /* The mockup's shape as a G6 layout: levels above a CSU fan out top to
   * bottom, a CSC's CSUs stack as an indented list, and an opened CSU fans
   * its relation cards below it. Siblings are packed by outline (the
   * tidy-tree contour rule), so one open fan moves only the neighbours it
   * would touch. */

  var H_GAP = 18; // between siblings laid side by side
  var V_GAP = 34; // between a box and the row of children below it
  var LIST_GAP = 10; // between rows of a vertical list
  var LIST_DROP = 16; // between a box and the first row of its list
  var INDENT = 26; // a list row's inset from its parent's left edge
  var TAIL = 12; // where the list trunk leaves the parent's bottom edge

  var FAN_LEVELS = { root: true, csms: true, css: true, csci: true };

  class DsmTreeLayout extends G6.BaseLayout {
    get id() {
      return "dsm-tree";
    }
  }

  DsmTreeLayout.prototype.execute = function (model) {
    var byId = {};
    var isChild = {};
    (model.nodes || []).forEach(function (node) {
      byId[node.id] = node;
    });
    (model.nodes || []).forEach(function (node) {
      (node.children || []).forEach(function (child) {
        isChild[child] = true;
      });
    });
    var roots = (model.nodes || []).filter(function (node) {
      return !isChild[node.id];
    });

    // The open children the layout has to place: closed boxes hide theirs.
    function shownChildren(node) {
      if (!node || G6.isCollapsed(node)) {
        return [];
      }
      return (node.children || []).map(function (id) {
        return byId[id];
      }).filter(Boolean);
    }

    // A subtree laid out on its own with its box's top-left at (0, 0): its
    // node centres and an outline of y bands holding the extent of anything
    // drawn in each. Packing by outline lets a wide fan deep in one branch
    // push a neighbour only where the two meet.
    function layoutOf(node) {
      var ownW = widthOf(node);
      var ownH = heightOf(node);
      var nodes = [{ id: node.id, x: ownW / 2, y: ownH / 2 }];
      var bands = [{ y0: 0, y1: ownH, l: 0, r: ownW }];
      var children = shownChildren(node);
      var level = (node.data || {}).level;
      var subs = children.map(layoutOf);
      if (!children.length) {
        // Nothing beneath.
      } else if (FAN_LEVELS[level]) {
        // A row of children packed side by side, the box centred over the
        // span of their boxes; the orthogonal edges run in the strip between.
        var top = ownH + V_GAP;
        var packed = packRow(subs, top);
        var first = packed[0] + subs[0].ownW / 2;
        var last = packed[packed.length - 1] + subs[subs.length - 1].ownW / 2;
        var shift = ownW / 2 - (first + last) / 2;
        subs.forEach(function (sub, i) {
          adopt(nodes, bands, sub, packed[i] + shift, top);
        });
        bands.push({ y0: ownH, y1: top, l: Math.min(ownW / 2, first + shift), r: Math.max(ownW / 2, last + shift) });
      } else if (level === "csu") {
        // A CSU's relation groups fan out below it from its left edge; the
        // edges leave its tail and spread to the groups' centres.
        var groupTop = BOX_HEIGHT + V_GAP;
        var at = packRow(subs, groupTop);
        subs.forEach(function (sub, i) {
          adopt(nodes, bands, sub, at[i], groupTop);
        });
        var lastAt = at[at.length - 1] + subs[subs.length - 1].ownW / 2;
        bands.push({ y0: BOX_HEIGHT, y1: groupTop, l: TAIL, r: Math.max(TAIL + 1, lastAt) });
      } else {
        // A list: the rows stacked beneath, inset, each taking the full
        // height of its own subtree; the trunk runs down from the tail.
        var y = ownH + LIST_DROP;
        var lastCentre = y;
        subs.forEach(function (sub) {
          adopt(nodes, bands, sub, INDENT, y);
          lastCentre = y + sub.ownH / 2;
          y += sub.h + LIST_GAP;
        });
        bands.push({ y0: ownH, y1: lastCentre, l: TAIL, r: TAIL + 1 });
      }
      var outline = mergeBands(bands);
      var l = Infinity;
      var r = -Infinity;
      var h = 0;
      outline.forEach(function (band) {
        l = Math.min(l, band.l);
        r = Math.max(r, band.r);
        h = Math.max(h, band.y1);
      });
      return { nodes: nodes, outline: outline, ownW: ownW, ownH: ownH, l: l, r: r, h: h };
    }

    // Moves a laid-out subtree into its parent's coordinates at (dx, dy).
    function adopt(nodes, bands, sub, dx, dy) {
      sub.nodes.forEach(function (n) {
        nodes.push({ id: n.id, x: n.x + dx, y: n.y + dy });
      });
      sub.outline.forEach(function (band) {
        bands.push({ y0: band.y0 + dy, y1: band.y1 + dy, l: band.l + dx, r: band.r + dx });
      });
    }

    // The x offsets of subtrees laid side by side at the same top: each is
    // placed as far left as its outline allows beside everything before it,
    // keeping H_GAP clear wherever the outlines share a band of y.
    function packRow(subs, top) {
      var offsets = [];
      var taken = [];
      subs.forEach(function (sub, i) {
        var dx = i ? -Infinity : 0;
        if (i) {
          sub.outline.forEach(function (band) {
            taken.forEach(function (t) {
              if (band.y0 + top < t.y1 && band.y1 + top > t.y0) {
                dx = Math.max(dx, t.r + H_GAP - band.l);
              }
            });
          });
          if (dx === -Infinity) {
            dx = offsets[i - 1] + subs[i - 1].r - sub.l + H_GAP;
          }
        }
        offsets.push(dx);
        sub.outline.forEach(function (band) {
          taken.push({ y0: band.y0 + top, y1: band.y1 + top, l: band.l + dx, r: band.r + dx });
        });
        taken = mergeBands(taken);
      });
      return offsets;
    }

    // Overlapping bands folded into one outline: between every pair of
    // neighbouring y breakpoints, the extremes of the bands covering it.
    function mergeBands(bands) {
      var ys = [];
      bands.forEach(function (band) {
        ys.push(band.y0, band.y1);
      });
      ys.sort(function (a, b) {
        return a - b;
      });
      var out = [];
      for (var i = 0; i + 1 < ys.length; i++) {
        var y0 = ys[i];
        var y1 = ys[i + 1];
        if (y1 - y0 < 0.5) {
          continue;
        }
        var l = Infinity;
        var r = -Infinity;
        bands.forEach(function (band) {
          if (band.y0 <= y0 && band.y1 >= y1) {
            l = Math.min(l, band.l);
            r = Math.max(r, band.r);
          }
        });
        if (l === Infinity) {
          continue;
        }
        var prev = out[out.length - 1];
        if (prev && prev.y1 === y0 && prev.l === l && prev.r === r) {
          prev.y1 = y1;
        } else {
          out.push({ y0: y0, y1: y1, l: l, r: r });
        }
      }
      return out;
    }

    var placed = [];
    var x = 0;
    roots.forEach(function (root) {
      var sub = layoutOf(root);
      sub.nodes.forEach(function (n) {
        placed.push({ id: n.id, style: { x: n.x + x - sub.l, y: n.y } });
      });
      x += sub.r - sub.l + H_GAP * 3;
    });
    return Promise.resolve({ nodes: placed, edges: [] });
  };

  G6.register(G6.ExtensionCategory.LAYOUT, "dsm-tree", DsmTreeLayout);

  // A fan child hangs from its parent's bottom centre by the orthogonal
  // router; a list row leaves the trunk at the parent's tail with one elbow
  // at its height. The elbow is read from current positions on every draw,
  // since collapse-expand shifts positions after the layout.
  function edgeStyle(edge) {
    if (mode === "hw") {
      return hardwareEdgeStyle(edge);
    }
    var source = graph.getNodeData(edge.source);
    var target = graph.getNodeData(edge.target);
    var level = ((target || {}).data || {}).level;
    if (level !== "csu") {
      return { router: { type: "orth" }, sourcePort: "out", targetPort: "in" };
    }
    var sourceStyle = (source || {}).style || {};
    var targetStyle = (target || {}).style || {};
    return {
      router: false,
      sourcePort: "tail",
      targetPort: "left",
      endArrow: true,
      endArrowSize: 6,
      endArrowType: "triangle",
      endArrowFill: COLOR.line,
      controlPoints: [[(sourceStyle.x || 0) - widthOf(source) / 2 + TAIL, targetStyle.y || 0]]
    };
  }

  // The taps of the hardware view run straight, port to port, from a card's
  // foot down to a bus; the device name stays in the hover card.
  function hardwareEdgeStyle(edge) {
    var data = edge.data || {};
    return { router: false, sourcePort: data.sourcePort, targetPort: data.targetPort };
  }

  /* -------------------------------------------------------------- tooltip */

  function row(rows, key, value) {
    var dt = document.createElement("dt");
    dt.textContent = key;
    var dd = document.createElement("dd");
    dd.textContent = shown(value);
    rows.appendChild(dt);
    rows.appendChild(dd);
  }

  // The attribute rows of a node, topic, message or library, shown on hover (req 43).
  function entityRows(rows, kind, ref, attrs) {
    if (kind === "topic") {
      var qos = attrs.qos || {};
      row(rows, "Size", attrs.size === -1 ? MISSING : attrs.size);
      row(rows, "Frequency", attrs.frequency);
      row(rows, "Criticality", attrs.criticality);
      row(rows, "Durability", qos.durability);
      row(rows, "Reliability", qos.reliability);
      row(rows, "Transport priority", qos.transport_priority);
    } else if (kind === "message") {
      row(rows, "Message id", attrs.message_id);
      row(rows, "Size", attrs.size === -1 ? MISSING : attrs.size);
      row(rows, "Frequency", attrs.frequency);
    } else if (kind === "lib") {
      row(rows, "Version", attrs.version);
    }
    row(rows, "Id", ref);
    row(rows, "In", plural(((tree && tree.copies[ref]) || []).length, "CSU"));
  }

  // The hover card: a title with the kind beside it, then attribute rows.
  // textContent throughout: nothing from the file is parsed as markup.
  function tipCard(label, kindText, fill) {
    var box = document.createElement("div");
    box.className = "tip";
    var title = document.createElement("p");
    title.className = "tip__title";
    title.textContent = String(label);
    var kind = document.createElement("span");
    kind.className = "tip__kind";
    kind.textContent = kindText || "";
    title.appendChild(kind);
    box.appendChild(title);
    var rows = document.createElement("dl");
    rows.className = "tip__rows";
    fill(rows);
    box.appendChild(rows);
    return box;
  }

  // The hover card of a box: its attributes, and for a level the counts beneath (req 43).
  function tooltipFor(event, items) {
    var datum = items && items[0];
    if (!datum || !datum.data) {
      return "";
    }
    var data = datum.data;
    var attrs = data.attrs || {};
    if (data.edge) {
      // A line of the hardware view: the port it leaves by and what it joins.
      return tipCard(data.from + " \u2014 " + data.to, "Connects to", function (rows) {
        row(rows, "Device", data.device);
        row(rows, "Raw device", data.dev_raw);
      });
    }
    return tipCard(data.label || datum.id, data.tag || KIND_NAMES[data.kind] || "", function (rows) {
      switch (data.level) {
        case "node":
          row(rows, "Group", attrs.group);
          row(rows, "Hardware", attrs.hw);
          row(rows, "OS", attrs.os);
          row(rows, "Middleware", attrs.mw);
          row(rows, "GPU", attrs.gpu);
          row(rows, "Display", attrs.display);
          row(rows, "Networks", (data.networks || []).map(linkLabel).join(", "));
          row(rows, "CSUs", data.units);
          row(rows, "Id", datum.id);
          break;
        case "bus":
          row(rows, "Purpose", attrs.purpose);
          row(rows, "Nodes", data.count);
          row(rows, "Id", attrs.id);
          break;
        case "root":
        case "csms":
        case "css":
        case "csci":
        case "csc":
          // The level below, named: "CSCIs 8" rather than "Children 8"; then
          // every software unit beneath.
          var below = childCount(datum);
          row(rows, CHILD_NAMES[data.level] + (below === 1 ? "" : "s"), below);
          row(rows, "Software units", data.count);
          break;
        case "csu":
          row(rows, "Version", attrs.version);
          row(rows, "Roles", (attrs.role || []).join(", "));
          row(rows, "Critical", attrs.criticality ? "yes" : "no");
          row(rows, "Priority", attrs.priority);
          row(rows, "Hot standby", attrs.hotstandby ? "yes" : "no");
          row(rows, "Description", (attrs.system_hierarchy || {}).csu_description);
          break;
        default:
          entityRows(rows, data.kind, data.ref, attrs);
      }
    });
  }

  /* The rows of a relation card are DOM, outside G6's tooltip plugin, so
   * they get the same card from a tooltip element of the page's own. */

  function showRowTip(rowEl, event) {
    var kind = rowEl.getAttribute("data-kind");
    var ref = rowEl.getAttribute("data-ref");
    var entity = ((tree && tree.entities[kind]) || {})[ref] || {};
    el.rowTip.textContent = "";
    el.rowTip.appendChild(
      tipCard(entity.name || rowEl.textContent, KIND_NAMES[kind] || kind, function (rows) {
        entityRows(rows, kind, ref, entity);
      })
    );
    el.rowTip.hidden = false;
    moveRowTip(event);
  }

  function moveRowTip(event) {
    var host = el.graph.getBoundingClientRect();
    var x = event.clientX - host.left + 14;
    var y = event.clientY - host.top + 14;
    // Keep the card inside the graph area.
    x = Math.min(x, host.width - el.rowTip.offsetWidth - 8);
    y = Math.min(y, host.height - el.rowTip.offsetHeight - 8);
    // left/top rather than a transform: the card's frosted fill is a fixed
    // background, and a transform would carry it along instead.
    el.rowTip.style.left = Math.max(0, x) + "px";
    el.rowTip.style.top = Math.max(0, y) + "px";
  }

  function hideRowTip() {
    el.rowTip.hidden = true;
  }

  // The event target's nearest ancestor matching the selector, or null.
  function closest(event, selector) {
    return event.target && event.target.closest ? event.target.closest(selector) : null;
  }

  /* ---------------------------------------------------------------- graph */

  // The stage runs under the stepper on the header line: a fitted tree
  // keeps clear of it at the top, and of the edges elsewhere.
  var PADDING = [100, 24, 24, 24];
  // The hardware view opens at its top left; the top is the least clearance,
  // raised at fit time to pass under the title and context line, which
  // float over the canvas (topClearance).
  var PADDING_HW = [48, 24, 24, 24];
  var OVERLAY_GAP = 36;

  // How far the fixed title (the mode switch) and context line reach into
  // the canvas, plus a gap: where the first bus may start.
  function topClearance() {
    var host = el.graph.getBoundingClientRect();
    var bottom = -Infinity;
    [document.querySelector(".shell--graph .title"), document.getElementById("graph-context")].forEach(function (node) {
      if (node && !node.hidden) {
        var rect = node.getBoundingClientRect();
        if (rect.height) {
          bottom = Math.max(bottom, rect.bottom);
        }
      }
    });
    return Math.max(PADDING_HW[0], bottom - host.top + OVERLAY_GAP);
  }

  function makeGraph(data) {
    return new G6.Graph({
      container: el.graph,
      // No autoFit: fitTree sets the opening view after the render.
      padding: mode === "hw" ? PADDING_HW : PADDING,
      // Zoom range (req 43); the floor keeps a fit-to-view of a fully opened
      // CSC, thousands of pixels wide, from shrinking the boxes out of sight.
      zoomRange: [0.2, 3],
      animation: false,
      data: data,
      // The hardware view's positions come with its data; the tree is laid out.
      layout: mode === "hw" ? undefined : { type: "dsm-tree" },
      node: {
        type: "html",
        style: nodeStyle,
        // Both states draw the card from the full state list, so a box that
        // is hovered and lit by the search shows both whichever G6 applies last.
        state: {
          active: function (datum) {
            return { innerHTML: htmlOf(datum, modifiersOf(datum)) };
          },
          highlight: function (datum) {
            return { innerHTML: htmlOf(datum, modifiersOf(datum)) };
          }
        }
      },
      edge: {
        type: mode === "hw" ? "line" : "polyline",
        style: function (edge) {
          var style = edgeStyle(edge);
          if (mode !== "hw") {
            style.radius = 6;
          }
          style.stroke = COLOR.line;
          style.lineWidth = 1.25;
          return style;
        },
        state: {
          // Lit white, like the hovered card: no halo, since the rows of a
          // list share one trunk and G6's halo would stack into a thick band.
          active: { stroke: "#ffffff", lineWidth: 1.75, halo: false }
        }
      },
      // Pan, zoom and click to expand or collapse (req 43); the hardware
      // view has nothing to fold.
      behaviors: ["drag-canvas", "zoom-canvas"]
        .concat(
          mode === "hw"
            ? []
            : {
                type: "collapse-expand",
                trigger: "click",
                animation: false,
                align: true,
                // An opened box moves to the middle of the stage and takes the find's
                // gold like a search result; a closed one takes the gold where it is.
                onExpand: function (id) {
                  light(id);
                  graph.focusElement(id, false);
                },
                onCollapse: light
              }
        )
        .concat({ type: "hover-activate", degree: 1 }),
      // Attribute display on hover (req 43); the hardware view's lines too.
      plugins: [
        {
          type: "tooltip",
          key: "tooltip",
          trigger: "hover",
          enable: function (event, items) {
            var datum = items && items[0];
            if (!datum || !datum.data) {
              return false;
            }
            if (event.targetType === "edge") {
              return !!datum.data.edge;
            }
            return datum.data.level !== "group" && datum.data.level !== "glabel" && event.targetType === "node";
          },
          getContent: function (event, items) {
            return Promise.resolve(tooltipFor(event, items));
          }
        }
      ]
    });
  }

  function render(msd) {
    openBuses = mode === "hw" ? defaultOpen(msd) : {};
    tree = mode === "hw" ? buildHardware(msd, openBuses) : buildTree(msd);
    lit = null;
    resetChips();
    pending = Promise.resolve();
    if (graph) {
      graph.destroy();
      dropLayers();
    }
    graph = makeGraph(tree.data);
    // The pointer entering or leaving the lit card redraws it, which resets
    // its rows' scroll; bring the lit row back into view.
    graph.on("node:pointerenter", relitRow);
    graph.on("node:pointerleave", relitRow);
    // The hardware view's lines follow the view (see stretchLines).
    lineSpan = null;
    graph.on("aftertransform", queueStretch);
    // For the browser console and the page's tests.
    window.dsmGraph = graph;
    return graph
      .render()
      .then(fitPicture)
      .then(function () {
        if (el.panel) {
          el.panel.hidden = false;
          clearQuery();
        }
      });
  }

  // G6 5.1 leaves its DOM layer in the container when a graph is destroyed;
  // one per picture drawn would pile up and squeeze the next canvas.
  function dropLayers() {
    Array.prototype.slice.call(el.graph.children).forEach(function (child) {
      if (child !== el.rowTip) {
        el.graph.removeChild(child);
      }
    });
  }

  // The hover card does not notice the pointer jumping to a toolbar button.
  function hideTooltip() {
    var tooltip = graph && graph.getPluginInstance("tooltip");
    if (tooltip && tooltip.hide) {
      tooltip.hide();
    }
  }

  // The tree fitted to the stage but never enlarged past zoom 1 (req 43):
  // a wide tree shrinks to fit, a small one opens centred at its natural size.
  function fitTree() {
    return graph.fitView().then(function () {
      if (graph.getZoom() <= 1) {
        return undefined;
      }
      return graph.zoomTo(1, false).then(function () {
        return graph.fitCenter();
      });
    });
  }

  // The hardware picture is tall and narrow: fitted to the stage's width,
  // never enlarged past zoom 1, and opened at its top under the title block,
  // where the first buses are, rather than shrunk whole into the stage.
  function fitHardware() {
    var nodes = (tree && tree.data && tree.data.nodes) || [];
    if (!nodes.length) {
      return graph.fitCenter();
    }
    var left = Infinity;
    var right = -Infinity;
    var top = Infinity;
    nodes.forEach(function (node) {
      var data = node.data || {};
      var h = heightOf(node);
      // A bus counts for its content run, not the reach of its line.
      var w = data.level === "bus" ? data.run : widthOf(node);
      left = Math.min(left, node.style.x - w / 2);
      right = Math.max(right, node.style.x + w / 2);
      top = Math.min(top, node.style.y - h / 2);
    });
    var size = graph.getSize();
    var zoom = Math.max(0.2, Math.min(1, (size[0] - PADDING_HW[1] - PADDING_HW[3]) / (right - left)));
    return graph
      .zoomTo(zoom, false)
      .then(function () {
        var at = graph.getViewportByCanvas([left, top]);
        return graph.translateBy([PADDING_HW[3] - at[0], topClearance() - at[1]], false);
      })
      .then(stretchLines);
  }

  function fitPicture() {
    return mode === "hw" ? fitHardware() : fitTree();
  }

  // Rebuilds the tree with the given fold and draws it in one pass: one
  // layout, rather than one per box opened.
  function rebuild(open) {
    hideTooltip();
    lit = null;
    tree = buildTree(lastModel, open);
    graph.setData(tree.data);
    return graph.render().then(function () {
      // The results point at the rebuilt tree's entries.
      renderResults();
      return fitTree();
    });
  }

  // Expand all (open) or Collapse all (req 43), queued behind any expansion
  // in flight.
  function queueRebuild(open) {
    if (!graph || !tree) {
      return Promise.resolve();
    }
    pending = pending.then(function () {
      return rebuild(open);
    });
    return pending;
  }

  /* The hardware view's fold: the open buses' cards are rebuilt in place,
   * and the view shifts so the bus toggled stays where it was. */

  function rebuildHardware(anchorId) {
    hideTooltip();
    var before = anchorId && nodeData(anchorId) ? graph.getViewportByCanvas([0, nodeData(anchorId).style.y])[1] : null;
    // The find's gold comes off first: G6 keeps an element's states across
    // setData, so a card lit before the rebuild would stay gold.
    return clearLit()
      .then(function () {
        tree = buildHardware(lastModel, openBuses);
        graph.setData(tree.data);
        return graph.render();
      })
      .then(function () {
        renderResults();
        var shift = 0;
        if (before !== null && nodeData(anchorId)) {
          shift = before - graph.getViewportByCanvas([0, nodeData(anchorId).style.y])[1];
        }
        // Cards open above the lines: when the grid's top would land under the
        // title block, the view shifts down to show it instead.
        var top = Infinity;
        (tree.data.nodes || []).forEach(function (node) {
          top = Math.min(top, node.style.y - heightOf(node) / 2);
        });
        if (top !== Infinity) {
          var topAt = graph.getViewportByCanvas([0, top])[1] + shift;
          shift += Math.max(0, topClearance() - topAt);
        }
        return (shift ? graph.translateBy([0, shift], false) : Promise.resolve()).then(stretchLines);
      });
  }

  function toggleBus(busId) {
    if (!graph || mode !== "hw" || !tree || !tree.entities.network[busId]) {
      return Promise.resolve();
    }
    pending = pending.then(function () {
      if (openBuses[busId]) {
        delete openBuses[busId];
      } else {
        openBuses[busId] = true;
      }
      return rebuildHardware(busId);
    });
    return pending;
  }

  // Every bus open (all cards shown) or closed (the lines alone).
  function foldBuses(open) {
    if (!graph || mode !== "hw" || !tree) {
      return Promise.resolve();
    }
    pending = pending.then(function () {
      openBuses = {};
      if (open) {
        Object.keys(tree.entities.network).forEach(function (id) {
          openBuses[id] = true;
        });
      }
      return rebuildHardware(null);
    });
    return pending;
  }

  /* --------------------------------------------------------------- search */

  var LIMIT = 40;
  // Results come ranked by how the query hits (prefix, word start, inside),
  // then by type in this order, then shortest name first.
  var TYPE_ORDER = { csu: 0, hierarchy: 1, node: 2, network: 2, topic: 3, message: 4, lib: 5, relation: 6 };

  // The panel's state: the pressed chips, the rows on show, the selected row
  // (lit until the next pick or query change) and the entity refs whose
  // per-CSU lines are open.
  var types = [];
  var rows = [];
  var cursor = -1;
  var opened = {};

  // Matches the index by name, narrowed to the pressed types (req 43).
  function search(query, kinds) {
    var q = query.trim().toLowerCase();
    if (!tree || (!q && !kinds.length)) {
      return { total: 0, rows: [] };
    }
    var hits = [];
    tree.index.forEach(function (entry) {
      if (kinds.length && kinds.indexOf(entry.type) === -1) {
        return;
      }
      var at = q ? entry.text.indexOf(q) : 0;
      if (at === -1) {
        return;
      }
      hits.push({ entry: entry, rank: at === 0 ? 0 : /[\s_\-\/.]/.test(entry.text.charAt(at - 1)) ? 1 : 2 });
    });
    hits.sort(function (a, b) {
      return (
        a.rank - b.rank ||
        TYPE_ORDER[a.entry.type] - TYPE_ORDER[b.entry.type] ||
        a.entry.label.length - b.entry.label.length ||
        compareText(a.entry.label, b.entry.label)
      );
    });
    return {
      total: hits.length,
      rows: hits.slice(0, LIMIT).map(function (hit) {
        return hit.entry;
      })
    };
  }

  // The labels above a box, top down, without the synthetic root.
  function pathOf(id) {
    var names = [];
    var parent = tree.parents[id];
    while (parent) {
      if (parent !== "root") {
        names.unshift(tree.labels[parent]);
      }
      parent = tree.parents[parent];
    }
    return names;
  }

  function elem(tag, className, text) {
    var node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  // One row of the results: glyph, name over its path, the kind at the end.
  // A copy line names the CSU, with the card and the CSC under it.
  function resultRow(row, i) {
    var entry = row.entry;
    var node = elem("div", "gsearch__row" + (row.copyId ? " gsearch__row--copy" : "") + (i === cursor ? " gsearch__row--active" : ""));
    node.setAttribute("role", "option");
    node.setAttribute("aria-selected", i === cursor ? "true" : "false");
    node.setAttribute("data-index", String(i));
    var glyph = elem("i", "gsearch__glyph lucide " + (row.copyId ? GLYPHS.csu : entry.glyph));
    var text = elem("span", "gsearch__text");
    node.appendChild(glyph);
    node.appendChild(text);
    if (row.copyId) {
      var csuId = row.copyId.split("/")[0];
      var csuName = tree.labels[csuId] || csuId;
      text.appendChild(elem("span", "gsearch__label", csuName));
      text.appendChild(elem("span", "gsearch__path", tree.labels[row.copyId] + " \u00b7 " + pathOf(csuId).slice(-1).join("")));
      node.title = csuName;
      return node;
    }
    text.appendChild(elem("span", "gsearch__label", entry.label));
    var path = entry.path !== undefined ? entry.path : entry.copies ? "in " + plural(entry.copies.length, "CSU") : pathOf(entry.id).join(" \u203a ");
    if (path) {
      text.appendChild(elem("span", "gsearch__path", path));
    }
    node.appendChild(elem("span", "gsearch__kind", entry.tag));
    node.title = entry.label;
    return node;
  }

  function renderResults() {
    if (!el.panel) {
      return;
    }
    var query = el.input.value;
    el.clear.hidden = !query;
    var found = search(query, types);
    rows = [];
    found.rows.forEach(function (entry) {
      rows.push({ entry: entry });
      if (entry.copies && opened[entry.ref]) {
        entry.copies.forEach(function (groupId) {
          rows.push({ entry: entry, copyId: groupId });
        });
      }
    });
    cursor = Math.min(cursor, rows.length - 1);
    el.results.textContent = "";
    rows.forEach(function (row, i) {
      el.results.appendChild(resultRow(row, i));
    });
    var idle = !query.trim() && !types.length;
    el.results.hidden = idle || !rows.length;
    el.count.hidden = idle;
    el.count.textContent =
      found.total === 0 ? "No matches" : (found.total === 1 ? "1 match" : found.total + " matches") + (found.total > LIMIT ? " \u00b7 first " + LIMIT + " shown" : "");
  }

  function restyleCursor() {
    Array.prototype.forEach.call(el.results.children, function (node, i) {
      node.classList.toggle("gsearch__row--active", i === cursor);
      node.setAttribute("aria-selected", i === cursor ? "true" : "false");
    });
  }

  function moveCursor(delta) {
    if (!rows.length) {
      return;
    }
    cursor = Math.max(0, Math.min(rows.length - 1, cursor + delta));
    restyleCursor();
    var active = el.results.children[cursor];
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: "nearest" });
    }
  }

  function clearQuery() {
    if (!el.panel) {
      return;
    }
    el.input.value = "";
    opened = {};
    cursor = -1;
    renderResults();
  }

  // A result picked (req 43): a copy line or single-copy entity goes to its
  // row, an entity on several cards opens its lines, a box goes to itself.
  function pick(i) {
    var row = rows[i];
    if (!row) {
      return;
    }
    cursor = i;
    restyleCursor();
    var entry = row.entry;
    if (row.copyId) {
      goTo(row.copyId, entry.ref);
    } else if (entry.copies) {
      if (entry.copies.length === 1) {
        goTo(entry.copies[0], entry.ref);
      } else {
        opened[entry.ref] = !opened[entry.ref];
        cursor = opened[entry.ref] ? i + 1 : i;
        renderResults();
      }
    } else {
      goTo(entry.id, null);
    }
  }

  function nodeData(id) {
    try {
      return graph.getNodeData(id);
    } catch (error) {
      return undefined;
    }
  }

  // Adds or removes one state, keeping the others (hover's "active" among them).
  function withState(id, name, on) {
    var current = graph.getElementState(id);
    var has = current.indexOf(name) !== -1;
    if (on === has) {
      return Promise.resolve();
    }
    var next = on
      ? current.concat(name)
      : current.filter(function (state) {
          return state !== name;
        });
    return graph.setElementState(id, next, false);
  }

  // Lights one box, and the row ref names on it, as the find (req 43).
  function light(nodeId, ref) {
    return clearLit().then(function () {
      lit = { nodeId: nodeId, ref: ref === undefined ? null : ref };
      return withState(nodeId, "highlight", true);
    });
  }

  function clearLit() {
    if (!lit) {
      return Promise.resolve();
    }
    var old = lit;
    lit = null;
    return graph && nodeData(old.nodeId) ? withState(old.nodeId, "highlight", false) : Promise.resolve();
  }

  // The drawn card of a box; ids hold ":" and "/", so no selector is built from them.
  function boxElement(nodeId) {
    var boxes = el.graph.querySelectorAll(".box");
    for (var i = 0; i < boxes.length; i += 1) {
      if (boxes[i].getAttribute("data-id") === nodeId) {
        return boxes[i];
      }
    }
    return null;
  }

  // Scrolls the lit row to the middle of its card's list, when the list scrolls.
  function scrollLitRow() {
    if (!lit || lit.ref === null) {
      return;
    }
    var box = boxElement(lit.nodeId);
    var row = box && box.querySelector(".list__row--highlight");
    var list = row && row.parentNode;
    if (list && list.classList.contains("list--scroll")) {
      list.scrollTop = row.offsetTop - list.offsetTop - (list.clientHeight - ROW_HEIGHT) / 2;
    }
  }

  function relitRow(event) {
    if (lit && event.target && event.target.id === lit.nodeId) {
      requestAnimationFrame(scrollLitRow);
    }
  }

  // Opens every closed box above the target, lights it and centres the view
  // on it (req 43); selections queue behind one another.
  function goTo(nodeId, ref) {
    if (!graph || !tree) {
      return Promise.resolve();
    }
    hideTooltip();
    hideRowTip();
    var chain = [];
    var parent = tree.parents[nodeId];
    while (parent) {
      chain.unshift(parent);
      parent = tree.parents[parent];
    }
    pending = pending
      .then(function () {
        // In the hardware view a picked bus opens, and a hidden card's buses open.
        if (mode !== "hw") {
          return undefined;
        }
        var need = [];
        if (tree.entities.network[nodeId]) {
          if (!openBuses[nodeId]) {
            need.push(nodeId);
          }
        } else if (!nodeData(nodeId)) {
          (tree.homes[nodeId] || []).forEach(function (link) {
            need.push(link.network);
          });
        }
        if (!need.length) {
          return undefined;
        }
        need.forEach(function (id) {
          openBuses[id] = true;
        });
        return rebuildHardware(null);
      })
      .then(function () {
        return chain.reduce(function (step, id) {
          return step.then(function () {
            var datum = nodeData(id);
            return datum && G6.isCollapsed(datum) ? graph.expandElement(id, false) : undefined;
          });
        }, Promise.resolve());
      })
      .then(function () {
        return light(nodeId, ref);
      })
      .then(function () {
        // After the box is drawn: centring reads its rendered bounds.
        return graph.focusElement(nodeId, false);
      })
      .then(scrollLitRow);
    return pending;
  }

  // Every chip released: a new picture starts with every type on.
  function resetChips() {
    types = [];
    cursor = -1;
    if (el.panel) {
      Array.prototype.forEach.call(el.panel.querySelectorAll(".gsearch__chip"), function (chip) {
        chip.setAttribute("aria-pressed", "false");
      });
    }
  }

  // The panel's parts and listeners, taken once with the container.
  function wirePanel(panel) {
    el.panel = panel;
    el.input = panel.querySelector("input");
    el.clear = panel.querySelector(".gsearch__clear");
    el.count = panel.querySelector(".gsearch__count");
    el.results = panel.querySelector(".gsearch__results");
    el.input.addEventListener("input", function () {
      cursor = -1;
      renderResults();
    });
    el.clear.addEventListener("click", function () {
      clearQuery();
      el.input.focus();
    });
    Array.prototype.forEach.call(panel.querySelectorAll(".gsearch__chip"), function (chip) {
      chip.addEventListener("click", function () {
        var on = chip.getAttribute("aria-pressed") !== "true";
        var type = chip.getAttribute("data-type");
        chip.setAttribute("aria-pressed", on ? "true" : "false");
        types = on
          ? types.concat(type)
          : types.filter(function (t) {
              return t !== type;
            });
        cursor = -1;
        renderResults();
      });
    });
    el.results.addEventListener("click", function (event) {
      var row = closest(event, ".gsearch__row");
      if (row) {
        pick(Number(row.getAttribute("data-index")));
      }
    });
    panel.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        clearQuery();
        clearLit();
        return;
      }
      if (event.target !== el.input) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        moveCursor(event.key === "ArrowDown" ? 1 : -1);
        event.preventDefault();
      } else if (event.key === "Enter" && rows.length) {
        pick(cursor < 0 ? 0 : cursor);
        event.preventDefault();
      }
    });
  }

  /* ------------------------------------------------------------------ api */

  var mounted = false;

  // Takes the container once, with the rows' hover card and wheel listeners
  // on it. The search panel is optional: without one the search is inert.
  function mount(container, panel) {
    if (mounted) {
      return;
    }
    mounted = true;
    el.graph = container;
    if (panel) {
      wirePanel(panel);
    }
    el.rowTip = document.createElement("div");
    el.rowTip.className = "tooltip tooltip--row";
    el.rowTip.hidden = true;
    el.graph.appendChild(el.rowTip);
    // A click on a bus's name or toggle folds its cards in or out.
    el.graph.addEventListener("click", function (event) {
      var label = closest(event, ".bus__label");
      var bus = label && label.closest(".bus");
      if (bus) {
        toggleBus(bus.getAttribute("data-id"));
      }
    });
    el.graph.addEventListener("mouseover", function (event) {
      var rowEl = closest(event, ".list__row");
      if (rowEl) {
        showRowTip(rowEl, event);
      }
    });
    el.graph.addEventListener("mousemove", function (event) {
      if (!el.rowTip.hidden) {
        if (closest(event, ".list__row")) {
          moveRowTip(event);
        } else {
          hideRowTip();
        }
      }
    });
    el.graph.addEventListener("mouseleave", hideRowTip);
    // A wheel over a card's rows scrolls them rather than zooming the view;
    // caught in the capture phase so G6 never forwards it.
    el.graph.addEventListener(
      "wheel",
      function (event) {
        var list = closest(event, ".list--scroll");
        if (!list) {
          return;
        }
        var atTop = list.scrollTop <= 0 && event.deltaY < 0;
        var atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1 && event.deltaY > 0;
        if (!atTop && !atBottom) {
          event.stopPropagation();
        }
      },
      true
    );
    window.addEventListener("resize", function () {
      if (graph) {
        graph.resize();
        queueStretch();
      }
    });
  }

  // Draws the model's graph (SRS DSM-SMM req 6, 7) in the given mode, "sw"
  // or "hw" (the current one when none); resolves once the first picture
  // is on screen.
  function load(msd, which) {
    if (!mounted) {
      return Promise.reject(new Error("mount() first"));
    }
    if (typeof G6 === "undefined" || !G6.Graph || !G6.treeToGraphData) {
      return Promise.reject(new Error("The graph library is missing."));
    }
    if (which === "sw" || which === "hw") {
      mode = which;
    }
    lastModel = msd;
    return (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () {
      return render(msd);
    });
  }

  function fit() {
    if (!graph) {
      return Promise.resolve();
    }
    hideTooltip();
    return fitPicture();
  }

  // Lets the container's size change through: the canvas follows it.
  function resize() {
    if (graph) {
      graph.resize();
    }
  }

  function destroy() {
    if (graph) {
      graph.destroy();
      dropLayers();
      graph = null;
    }
    lit = null;
    tree = null;
    lastModel = null;
    if (el.panel) {
      clearQuery();
      el.panel.hidden = true;
    }
  }

  window.DsmHierarchyGraph = {
    mount: mount,
    load: load,
    fit: fit,
    resize: resize,
    expandToCsu: function () {
      return mode === "hw" ? foldBuses(true) : queueRebuild(true);
    },
    collapseAll: function () {
      return mode === "hw" ? foldBuses(false) : queueRebuild(false);
    },
    destroy: destroy
  };
})();
