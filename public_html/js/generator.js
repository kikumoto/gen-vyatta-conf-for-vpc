$(function() {
  $('#generate').click(function() {
    try {
      var interface = $('#interface').val();
      var local_subnet = $('#local_subnet').val();
      var remote_subnet = $('#remote_subnet').val();
      var config_from_vpc = $('#config').val();
      validate(interface, local_subnet, remote_subnet, config_from_vpc);
      
      var replaceTable = makeReplaceTable(interface, local_subnet, remote_subnet, config_from_vpc);

      $('#config_result').val(generateConfiguration(replaceTable));
      $('#setupscript_result').val(generateSetupscript(replaceTable));
    } catch(e) {
      alert(e);
    }
  });
});

function makeReplaceTable(interface, local_subnet, remote_subnet, config_from_vpc) {
  var replaceTable = {};
  
  replaceTable['VYATTA_IPSEC_INTERFACE'] = interface;
  replaceTable['LOCAL_SUBNET'] = local_subnet;
  replaceTable['VPC_REMOTE_SUBNET'] = remote_subnet;

  // VPC からDLした構成情報から、必要な情報を取り出す。  
  var parser = new VPCConfigParser(config_from_vpc);
  replaceTable = $.extend(replaceTable, parser.parse());
  
  return replaceTable;
}

function generateConfiguration(replaceTable) {
  var base = $('#vyatta_config_template').text();
  return replaceAll(replaceTable, base);
}

function generateSetupscript(replaceTable) {
  var base = $('#vyatta_setupscript_template').text();
  return replaceAll(replaceTable, base);
}

function replaceAll(replaceTable, str) {
  for (var key in replaceTable) {
    var pattern = new RegExp(key, "g");
    str = str.replace(pattern, replaceTable[key]);
  }
  return str;
}

function validate(interface, local_subnet, remote_subnet, config_from_vpc) {
  var error_message = new Array();
  if (interface == "") {
    error_message.push("「Vyatta側でIPSecを利用するネットワークインターフェイス」が入力されていません。");
  }
  if (local_subnet == "") {
    error_message.push("「Vyatta側のネットワーク情報」が入力されていません。");
  }
  if (remote_subnet == "") {
    error_message.push("「Amazon VPC側のネットワーク情報」が入力されていません。");
  }
  if (config_from_vpc == "") {
    error_message.push("「Amazon VPCからダウンロードした設定情報」が入力されていません。");
  }
  
  if (error_message.length > 0) {
    throw error_message.join('\n');
  }
}

var VPCConfigParser = function(config) {
  this.config = config.split("\n");
  this.currentLine = 0;
  this.currentTunnelPrefix = "";
  this.replaceTable = {};
}

VPCConfigParser.prototype.parse = function() {
  var regForTunnel = new RegExp("^IPSec Tunnel #([0-9]+)");
  var len = this.config.length;

  for (; this.currentLine < len; this.currentLine++) {
    var line = this.config[this.currentLine];
    if (line.match(regForTunnel)) {
      var tunnelID = RegExp.$1;
      this.parseTunnel(tunnelID);
    }
  }
  
  return this.replaceTable;
}

VPCConfigParser.prototype.parseTunnel = function(tunnelID) {
  this.currentTunnelPrefix = "TUNNEL" + tunnelID + "_";
  
  var isEmptyLine = false;
  var len = this.config.length;
  for (; this.currentLine < len; this.currentLine++) {
    var line = this.config[this.currentLine];
    if ($.trim(line) == "") {
      if (isEmptyLine) {
        break;
      } else {
        isEmptyLine = true;
      }
    } else {
      isEmptyLine = false;
      if (line.match(/^Configure the IKE SA/)) {
        this.parseIKESA();
      } else if (line.match(/^Outside IP Addresses/)) {
        this.parseOutsideIP();
      } else if (line.match(/^Inside IP Addresses/)) {
        this.parseInsideIP();
      } else if (line.match(/^BGP Configuration Options/)) {
        this.parseBGP();
      }
    }
  }
}

VPCConfigParser.prototype.parseIKESA = function() {
  var len = this.config.length;
  for (; this.currentLine < len; this.currentLine++) {
    var line = this.config[this.currentLine];
    if ($.trim(line) == "") {
      break;
    }
    if (line.match(/- Pre-Shared Key\s+: ([^\s]+)/)) {
      this.replaceTable[this.currentTunnelPrefix + "PSK"] = RegExp.$1;
    }
  }
}

VPCConfigParser.prototype.parseOutsideIP = function() {
  var len = this.config.length;
  for (; this.currentLine < len; this.currentLine++) {
    var line = this.config[this.currentLine];
    if ($.trim(line) == "") {
      break;
    }
    if (line.match(/- Customer Gateway\s+: ([^\s]+)/)) {
      this.replaceTable[this.currentTunnelPrefix + "OUTSIDE_CGW_IP"] = RegExp.$1;
    } else if (line.match(/- Virtual Private Gateway\s+: ([^\s]+)/)) {
      this.replaceTable[this.currentTunnelPrefix + "OUTSIDE_VPGW_IP"] = RegExp.$1;
    }
  }
}

VPCConfigParser.prototype.parseInsideIP = function() {
  var len = this.config.length;
  for (; this.currentLine < len; this.currentLine++) {
    var line = this.config[this.currentLine];
    if ($.trim(line) == "") {
      break;
    }
    if (line.match(/- Customer Gateway\s+: ([^\s\/]+)\/([^\s]+)/)) {
      this.replaceTable[this.currentTunnelPrefix + "INSIDE_CGW_IP"] = RegExp.$1;
      this.replaceTable[this.currentTunnelPrefix + "INSIDE_CGW_NETMASK"] = RegExp.$2;
    } else if (line.match(/- Virtual Private Gateway\s+: ([^\s\/]+)\/([^\s]+)/)) {
      this.replaceTable[this.currentTunnelPrefix + "INSIDE_VPGW_IP"] = RegExp.$1;
      this.replaceTable[this.currentTunnelPrefix + "INSIDE_VPGW_NETMASK"] = RegExp.$2;
    }
  }
}

VPCConfigParser.prototype.parseBGP = function() {
  var len = this.config.length;
  for (; this.currentLine < len; this.currentLine++) {
    var line = this.config[this.currentLine];
    if ($.trim(line) == "") {
      break;
    }
    if (line.match(/- Customer Gateway ASN\s+: ([^\s]+)/)) {
      this.replaceTable[this.currentTunnelPrefix + "BGP_CONFIG_CGW_ASN"] = RegExp.$1;
    } else if (line.match(/- Virtual Private  Gateway ASN\s+: ([^\s]+)/)) {
      this.replaceTable[this.currentTunnelPrefix + "BGP_CONFIG_VPGW_ASN"] = RegExp.$1;
    } else if (line.match(/- Neighbor IP Address\s+: ([^\s]+)/)) {
      this.replaceTable[this.currentTunnelPrefix + "BGP_CONFIG_NEIGHBOR"] = RegExp.$1;
    }
  }
}
