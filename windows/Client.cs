using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System;
using System.IO;
using System.Net;
using System.Diagnostics;
using System.Windows.Forms;
using System.Threading;
class Client {
 const string DefaultServer="__SFF_SERVER_URL__";
 [STAThread] static void Main(string[] args){try{
 string baseDir=AppDomain.CurrentDomain.BaseDirectory;
 string state=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"SFF Signal Data");
 Directory.CreateDirectory(state);
 string config=Path.Combine(state,"server.txt"),url=DefaultServer.StartsWith("https://")?DefaultServer:(File.Exists(config)?File.ReadAllText(config).Trim():"http://127.0.0.1:4178");
 if(Array.IndexOf(args,"--server")>=0){string input=Microsoft.VisualBasic.Interaction.InputBox("HTTPS adresa zajedničkog SFF servera. Za lokalni server unesi http://127.0.0.1:4178.","SFF · Server",url);if(input=="")return;Uri u;if(!Uri.TryCreate(input,UriKind.Absolute,out u)||(u.Scheme!="https"&&input!="http://127.0.0.1:4178")||u.UserInfo!="")throw new Exception("Neispravna adresa servera.");url=u.GetLeftPart(UriPartial.Authority);File.WriteAllText(config,url);}
 if(url=="http://127.0.0.1:4178"){if(!Ready(url)){ProcessStartInfo server=new ProcessStartInfo(Path.Combine(baseDir,"node.exe"),"backend/server.mjs");server.WorkingDirectory=baseDir;server.UseShellExecute=false;server.CreateNoWindow=true;server.EnvironmentVariables["SFF_DATA"]=state;server.EnvironmentVariables["PORT"]="4178";server.EnvironmentVariables["HOST"]="127.0.0.1";Process.Start(server);int i=0;while(i++<50&&!Ready(url))Thread.Sleep(150);if(!Ready(url))throw new Exception("Lokalni server nije dostupan na portu 4178.");}}
 Application.EnableVisualStyles();
 Application.SetCompatibleTextRenderingDefault(false);
 SetCurrentProcessExplicitAppUserModelID("SFF.Signal.Desktop");
 using(Form window=new Form())
 using(WebView2 web=new WebView2()){
 window.Text="SFF";window.Icon=new System.Drawing.Icon(Path.Combine(baseDir,"SFF-Merkat-v3.ico"));window.BackColor=System.Drawing.Color.FromArgb(21,19,24);
 window.MinimumSize=new System.Drawing.Size(670,520);window.Size=new System.Drawing.Size(1200,800);window.StartPosition=FormStartPosition.CenterScreen;
 string bounds=Path.Combine(state,"desktop-bounds.txt");
 if(File.Exists(bounds)){int x,y,w,h;string[] saved=File.ReadAllText(bounds).Split(',');if(saved.Length>=4&&int.TryParse(saved[0],out x)&&int.TryParse(saved[1],out y)&&int.TryParse(saved[2],out w)&&int.TryParse(saved[3],out h)&&w>=670&&h>=520){var rect=new System.Drawing.Rectangle(x,y,w,h);foreach(Screen screen in Screen.AllScreens){if(screen.WorkingArea.Contains(new System.Drawing.Point(x+40,y+20))){window.StartPosition=FormStartPosition.Manual;window.Bounds=rect;break;}}if(saved.Length==5&&saved[4]=="max")window.WindowState=FormWindowState.Maximized;}}
 window.FormClosing+=(sender,e)=>{var b=window.WindowState==FormWindowState.Normal?window.Bounds:window.RestoreBounds;File.WriteAllText(bounds,string.Join(",",b.X,b.Y,b.Width,b.Height,window.WindowState==FormWindowState.Maximized?"max":"normal"));};
 web.DefaultBackgroundColor=window.BackColor;web.Dock=DockStyle.Fill;window.Controls.Add(web);
 window.Shown+=async (sender,e)=>{try{
 var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(state,"desktop-webview"));
 await web.EnsureCoreWebView2Async(env);var core=web.CoreWebView2;
 core.Settings.AreDevToolsEnabled=false;core.Settings.AreDefaultContextMenusEnabled=false;core.Settings.IsStatusBarEnabled=false;
 Uri home=new Uri(url);
 core.NavigationStarting+=(o,n)=>{Uri target;if(!Uri.TryCreate(n.Uri,UriKind.Absolute,out target)||target.GetLeftPart(UriPartial.Authority)!=home.GetLeftPart(UriPartial.Authority)){n.Cancel=true;OfferLink(window,n.Uri);}};
 core.NewWindowRequested+=(o,n)=>{n.Handled=true;Uri target;if(Uri.TryCreate(n.Uri,UriKind.Absolute,out target)&&target.GetLeftPart(UriPartial.Authority)==home.GetLeftPart(UriPartial.Authority))core.Navigate(target.AbsoluteUri);else OfferLink(window,n.Uri);};
 core.Navigate(url);
 }catch(Exception error){MessageBox.Show(window,error.Message,"SFF · Pokretanje");window.Close();}};
 Application.Run(window);}
 }catch(Exception e){MessageBox.Show(e.Message,"SFF",MessageBoxButtons.OK,MessageBoxIcon.Error);}}
 [System.Runtime.InteropServices.DllImport("shell32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)] static extern int SetCurrentProcessExplicitAppUserModelID(string id);
 static void OfferLink(Form owner,string link){Uri uri;if(Uri.TryCreate(link,UriKind.Absolute,out uri)&&(uri.Scheme=="https"||uri.Scheme=="http")&&MessageBox.Show(owner,uri.Host+" — kopirati spoljni link?","SFF",MessageBoxButtons.YesNo)==DialogResult.Yes)Clipboard.SetText(link);}
 static bool Ready(string url){try{HttpWebRequest r=(HttpWebRequest)WebRequest.Create(url+"/mark.svg");r.Timeout=500;using(var resp=r.GetResponse())return resp.ContentType=="image/svg+xml";}catch{return false;}}
}
