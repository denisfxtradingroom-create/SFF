using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
class Setup {
 static void Shortcut(string path,string exe,string args){Type t=Type.GetTypeFromProgID("WScript.Shell");dynamic shell=Activator.CreateInstance(t);dynamic link=shell.CreateShortcut(path);link.TargetPath=exe;link.Arguments=args;link.IconLocation=Path.Combine(Path.GetDirectoryName(exe),"SFF-Merkat-v3.ico")+",0";link.WorkingDirectory=Path.GetDirectoryName(exe);link.Save();}
 [STAThread] static void Main(string[] args){try{
 if(args.Length==2&&args[0]=="--extract"){Extract(Path.GetFullPath(args[1]));return;}
 bool update=Array.IndexOf(args,"--update")>=0;if(!update){var decision=MessageBox.Show("Instalirati SFF za ovaj Windows nalog i napraviti prečice na radnoj površini i u Start meniju?","SFF · Instalacija",MessageBoxButtons.OKCancel,MessageBoxIcon.Information);if(decision!=DialogResult.OK)return;}
 string dest=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","SFF Signal");
 Extract(dest);string exe=Path.Combine(dest,"SFF.exe");string menu=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"SFF Signal");Directory.CreateDirectory(menu);
 Shortcut(Path.Combine(menu,"SFF.lnk"),exe,"");Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"SFF.lnk"),exe,"");
 SHChangeNotify(0x08000000,0,IntPtr.Zero,IntPtr.Zero);if(!update)MessageBox.Show("Instalacija je završena. Otvori SFF preko prečice.","SFF");
 }catch(Exception e){Environment.ExitCode=1;MessageBox.Show(e.Message,"SFF · Instalacija");}}
 [System.Runtime.InteropServices.DllImport("shell32.dll")] static extern void SHChangeNotify(uint id,uint flags,IntPtr a,IntPtr b);
 static void Extract(string dest){Directory.CreateDirectory(dest);using(var s=Assembly.GetExecutingAssembly().GetManifestResourceStream("payload"))using(var z=new ZipArchive(s)){foreach(var e in z.Entries){string p=Path.GetFullPath(Path.Combine(dest,e.FullName));if(!p.StartsWith(dest+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new IOException("Neispravna putanja.");if(e.Name==""){Directory.CreateDirectory(p);continue;}Directory.CreateDirectory(Path.GetDirectoryName(p));if(e.Name=="node.exe" && File.Exists(p) && new FileInfo(p).Length==e.Length){using(var sha=System.Security.Cryptography.SHA256.Create())using(var old=File.OpenRead(p))using(var next=e.Open()){if(Convert.ToBase64String(sha.ComputeHash(old))==Convert.ToBase64String(sha.ComputeHash(next)))continue;}}e.ExtractToFile(p,true);}}}
}
