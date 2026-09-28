using System;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Nubi.Office.Core
{
    public static class CellStyle
    {
        public static readonly string[] Fields = { "bold", "italic", "fillColor", "numberFormat", "fontName", "fontSize", "fontColor", "horizontalAlignment", "verticalAlignment", "wrapText" };
        public static JToken Validate(string field, JToken value)
        {
            bool Valid()
            {
                switch (field)
                {
                    case "bold": case "italic": case "wrapText": return value.Type == JTokenType.Boolean;
                    case "fillColor": return value.Type == JTokenType.Null || Color(value);
                    case "fontColor": return Color(value);
                    case "numberFormat": return value.Type == JTokenType.String && value.ToString().Length > 0 && value.ToString().Length <= 120 && !Regex.IsMatch(value.ToString(), @"[\x00-\x1f]");
                    case "fontName": return value.Type == JTokenType.String && value.ToString().Trim().Length > 0 && value.ToString().Length <= 100 && !Regex.IsMatch(value.ToString(), @"[\x00-\x1f]");
                    case "fontSize": return (value.Type == JTokenType.Integer || value.Type == JTokenType.Float) && (double)value >= 1 && (double)value <= 409 && (double)value * 2 == Math.Truncate((double)value * 2);
                    case "horizontalAlignment": return value.Type == JTokenType.String && new[] { "general", "left", "center", "right", "fill", "justify", "centerAcrossSelection", "distributed" }.Contains(value.ToString());
                    case "verticalAlignment": return value.Type == JTokenType.String && new[] { "top", "center", "bottom", "justify", "distributed" }.Contains(value.ToString());
                    default: return false;
                }
            }
            if (!Valid()) throw new OfficeFault("invalid_format");
            return field.EndsWith("Color") && value.Type == JTokenType.String ? new JValue(value.ToString().ToUpperInvariant()) : value.DeepClone();
        }
        private static bool Color(JToken value) => value.Type == JTokenType.String && Regex.IsMatch(value.ToString(), "^#[0-9a-fA-F]{6}$");
    }
}
