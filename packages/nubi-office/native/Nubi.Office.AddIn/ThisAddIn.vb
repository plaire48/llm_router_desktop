' Modified for Nubi Office. Original VSTO host: it235/office-ai-agent, Apache-2.0.
Imports System.IO
Imports System.Collections.Generic
Imports System.Runtime.InteropServices
Imports Office = Microsoft.Office.Core

Partial Public Class ThisAddIn
    Private ReadOnly nubiPanes As New Dictionary(Of Integer, Microsoft.Office.Tools.CustomTaskPane)()

    Protected Overrides Function CreateRibbonExtensibilityObject() As Office.IRibbonExtensibility
        Return New NubiRibbon()
    End Function

    Public Sub ShowNubiTaskPane()
        Try
            Dim window = Me.Application.ActiveWindow
            If window Is Nothing Then Return
            Dim key As Integer = window.Hwnd
            Dim pane As Microsoft.Office.Tools.CustomTaskPane = Nothing
            If Not nubiPanes.TryGetValue(key, pane) Then
                Dim codeBase = New Uri(GetType(ThisAddIn).Assembly.CodeBase)
                Dim sourceDirectory = If(codeBase.IsFile, Path.GetDirectoryName(codeBase.LocalPath), Path.GetDirectoryName(GetType(ThisAddIn).Assembly.Location))
                Dim root = Path.Combine(sourceDirectory, "NubiOffice")
                Dim control As New Nubi.Office.Host.NubiPane(Me.Application, root)
                ' The embedded chat already supplies its own header.
                pane = Me.CustomTaskPanes.Add(control, String.Empty, window)
                pane.DockPosition = Office.MsoCTPDockPosition.msoCTPDockPositionRight
                pane.Width = 400
                nubiPanes.Add(key, pane)
            End If
            pane.Visible = True
        Catch
            System.Windows.Forms.MessageBox.Show("누비를 열지 못했습니다. 설치 파일을 확인해 주세요.", "누비")
        End Try
    End Sub

    Private Sub CloseNubiPanes() Handles Me.Shutdown
        For Each pane In nubiPanes.Values
            pane.Control.Dispose()
        Next
        nubiPanes.Clear()
    End Sub
End Class

<ComVisible(True)>
Public Class NubiRibbon
    Implements Office.IRibbonExtensibility

    Public Function GetCustomUI(ribbonId As String) As String Implements Office.IRibbonExtensibility.GetCustomUI
        Return "<customUI xmlns=""http://schemas.microsoft.com/office/2009/07/customui""><ribbon><tabs><tab id=""nubiTab"" label=""누비""><group id=""nubiGroup"" label=""Excel 도우미""><button id=""nubiOpen"" label=""누비 열기"" size=""large"" imageMso=""ReviewNewComment"" onAction=""OpenNubi"" screentip=""선택한 셀에 AI Agent 작업 요청""/></group></tab></tabs></ribbon></customUI>"
    End Function

    Public Sub OpenNubi(control As Office.IRibbonControl)
        Globals.ThisAddIn.ShowNubiTaskPane()
    End Sub
End Class
