#!/usr/bin/env node
"use strict";

var pjson = require('./package.json');
var yaml = require('js-yaml');
var fs   = require('fs');
var path   = require('path');
var express = require('express');

var showdown  = require('showdown');
var converter = new showdown.Converter();

var config = {};

const buildextensions = ["html", "md"];

var srcDir = process.cwd();
var buildDir = path.join(srcDir, "_site");

var excludedFiles = ["_layouts", "_includes", "_site", "_config.yml"];

/*
 * AIMS:
 * build - builds the site based on changed files
 * serve - builds and starts a webserver
 * clean - removes the built site
 * help - displays a help message, also the default if the command is unreconised
 */

let args = process.argv.splice(2);

if(args.length == 0)
{
  console.log("Unreconised command");
  displayHelp();
}
else
{
  let command = args[0].toLowerCase();

  if(command == "build")
  {
    parseConfig();
    buildSite();
  }
  else if (command == "serve")
  {
    parseConfig();
    buildSite();
    startServer();
    watchFiles();
  }
  else if(command == "clean")
  {
    parseConfig();
    cleanBuild();
  }
  else if(command == "help")
  {
    displayHelp();
  }
  else
  {
    console.log("Unreconised command");
    displayHelp();
  }
}

/********************
 * Functions
*********************/

function buildSite()
{
  let files = getRelevantFiles();

  if(!fs.existsSync(buildDir))
  {
    fs.mkdir(buildDir);
  }

  files.forEach(function(file) {
    processFile(file);
  });
}

function processFile(file)
{
  let fullpath = path.join(srcDir, file);
  let dpath = path.join(buildDir, file);

  let stats = fs.lstatSync(fullpath);
  if(stats.isDirectory()) return;

  let parts = file.split(".");
  let extension = (parts.length == 0) ? "" : parts[parts.length - 1];

  if(extension == "md")
  {
      dpath = dpath.substr(0, dpath.length - 3) + ".html";
  }

  if(fs.existsSync(dpath))
  {
    let dstats = fs.lstatSync(dpath);
    if(dstats.mtime >= stats.mtime) return;
  }

  if(buildextensions.includes(extension))
  {
    console.log('Building ' + file);
    let func = (src) => { return src; }

    if(extension == "md")
    {
        func = (src) => { return converter.makeHtml(src); }
    }

    buildFile(fullpath, dpath, true, {}, func);
  }
  else
  {
    console.log('Copying ' + file);
    asyncCopyFile(fullpath, dpath);
  }
}

function startServer()
{
  const app = express()

  app.use(express.static('_site'));

  app.listen(4000, () => {
    console.log('Website is built!\nPreview by entering http://localhost:4000/ into your web browser');
  });
}

function watchFiles()
{
  let dirs = getRelevantDirs();

  dirs.forEach(function(dir) {
    fs.watch(path.join(srcDir, dir), function (event, filename) {

      if (fs.existsSync(path.join(srcDir, dir, filename))) {
        processFile(path.join(dir, filename));
      }

    });
  });
}

function cleanBuild()
{
  removeDirectoriesRecursive(buildDir);
}

function buildFile(srcPath, destPath, ensureFrontmatter= true, variables = {}, buildFunc = (src) => { return src })
{
  if(variables == undefined)
  {
    variables = {};
  }

  if(variables.page == undefined)
  {
    variables.page = {};
  }

  let inbuffer = "";
  let outbuffer = "";
  let stream = fs.createReadStream(srcPath);
  stream.setEncoding('utf-8');
  stream.on('data', (chunk) => {
    inbuffer += chunk;
  });

  stream.on('end', () => {
    let lines = inbuffer.split('\n');
    let layout = undefined;
    let lineIdx = 0;

    if(lines[0].startsWith("---"))
    {
      // parse front matter
      while(lineIdx < lines.length-1)
      {
        lineIdx++;
        if(lines[lineIdx].startsWith("---"))
        {
          lineIdx++;
          break;
        }

        let parts = lines[lineIdx].split(":");

        if(parts[0] == "layout")
        {
          layout = parts[1].trim();
        }
        else if(parts[0] != "")
        {
          variables.page[parts[0]] = parts[1];
        }
      }
    }
    else if(ensureFrontmatter)
    {
      // just copy the file
      asyncCopyFile(srcPath, destPath);
      return;
    }

    while(lineIdx < lines.length)
    {
      let string = lines[lineIdx];
      let result = "";

      do
      {
        let vidx = string.indexOf("{{");
        let cidx = string.indexOf("{%");

        let startIdx = -1;
        let endIdx = -1;

        if((vidx < cidx || cidx == -1) && vidx != -1)
        {
          startIdx = vidx;
          endIdx = string.indexOf("}}");
        }
        else if(cidx != -1)
        {
          startIdx = cidx;
          endIdx = string.indexOf("%}");
        }
        else
        {
          break;
        }

        if(endIdx == -1)
        {
          console.warn("No end found to command ln:" + lineIdx + ", " + srcPath);
          break;
        }

        //add the string up to the variable to result
        result += string.substring(0, startIdx);

        //process the command portion and add it to the result
        result += processCommand(string.substring(startIdx + 2, endIdx), variables);

        //trim string to the next part we haven't processed
        string = string.substr(endIdx + 2);
      } while(true);

      outbuffer +=  result + string + "\n";
      lineIdx++;
    }

    if(layout != undefined)
    {
      variables.content = buildFunc(outbuffer);
      buildFile(path.join(process.cwd(), "_layouts", layout + ".html"), destPath, false, variables);
    }
    else
    {
      let wstream = fs.createWriteStream(destPath);
      wstream.end(outbuffer, 'utf-8');
    }
  });
}

function processCommand(cmd, variables)
{
  let words = cmd.trim().split(" ");

  if(words.length == 0)
  {
    return "";
  }

  if(words[0] == "include")
  {
    return fs.readFileSync(path.join(process.cwd(), "_includes", words[1]), 'utf-8');
  }
  else
  {
    return variables[words[0]];
  }
}

function asyncCopyFile(srcPath, destPath)
{
  createDirectories(destPath);
  fs.createReadStream(srcPath).pipe(fs.createWriteStream(destPath));
}

function createDirectories(filepath)
{
  let dir = path.dirname(filepath);

  if(!fs.existsSync(dir))
  {
    createDirectoriesRecursive(dir);
  }
}

function createDirectoriesRecursive(dir)
{
  let pdir = path.dirname(dir);

  if(!fs.existsSync(pdir))
  {
    createDirectoriesRecursive(pdir);
  }

  fs.mkdirSync(dir);
}

function removeDirectoriesRecursive(path)
{
  if(!fs.existsSync(path)) return;

  fs.readdirSync(path).forEach(function(file)
  {
    var curPath = path + "/" + file;

    if (fs.lstatSync(curPath).isDirectory())
    {
      removeDirectoriesRecursive(curPath);
    } else
    {
      fs.unlinkSync(curPath);
    }
  });

  fs.rmdirSync(path);
}

function getRelevantDirs()
{
  let dirs = [""];
  return dirs.concat(getRelevantDirsRecursive(""));
}

function getRelevantDirsRecursive(dir)
{
  let dirpath = path.join(srcDir, dir);
  let files = fs.readdirSync(dirpath);
  let rv = [];

  files.forEach(function(file) {
    if(fs.lstatSync(path.join(dirpath, file)).isDirectory() && !file.startsWith(".") && !excludedFiles.includes(file))
    {
      rv = rv.concat(getRelevantDirsRecursive(path.join(dir, file)));
      rv.push(path.join(dir, file));
    }
  });

  return rv;
}

function getRelevantFiles()
{
  return getRelevantFilesRecursive(process.cwd(), "");
}

function getRelevantFilesRecursive(rootPath, relativePath)
{
  let dirpath = path.join(rootPath, relativePath);
  let files = fs.readdirSync(dirpath);
  let returnVal = [];

  files.forEach(function(file) {
    if(!excludedFiles.includes(file) && !file.startsWith("."))
    {
      let fullpath = path.join(dirpath, file);
      // if this is a directory then do a recursive call
      if(fs.lstatSync(fullpath).isDirectory())
      {
        returnVal = returnVal.concat(getRelevantFilesRecursive(rootPath, path.join(relativePath, file), excludedFiles));
      }
      else
      {
        returnVal.push(path.join(relativePath, file));
      }
    }
  });

  return returnVal;
}


function parseConfig()
{
  try
  {
    config = yaml.safeLoad(fs.readFileSync('_config.yml', 'utf8'));

    if(typeof(config.exclude) !== undefined)
    {
      excludedFiles = excludedFiles.concat(config.exclude);
    }
  }
  catch (e)
  {
    config = {};
  }
}

function displayHelp()
{
  console.log("");
  console.log("Help:");
  console.log("");

  if(typeof(pjson.name) !== undefined)
  {
    console.log("** " + pjson.name + " **");
  }

  if(typeof(pjson.description) !== undefined)
  {
    console.log(pjson.description);
  }

  console.log("");
  console.log("Usage: njekyll <command>");
  console.log("Commands:")

  console.log("- build    Builds the site and saves it to the _site folder");
  console.log("- serve    Builds the site starts a webserver in the _site folder to preview changes");
  console.log("- clean    Deletes the _site folder if it exists");
  console.log("- help     Shows this help message");
}
